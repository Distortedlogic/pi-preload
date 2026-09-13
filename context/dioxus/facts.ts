import { execFile } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const DIOXUS_PLATFORMS = ["desktop", "mobile", "native", "server", "web"] as const;
const execFileAsync = promisify(execFile);

type DioxusPlatform = (typeof DIOXUS_PLATFORMS)[number];

export interface DioxusFacts {
	platforms: DioxusPlatform[];
	fullstack: boolean;
	router: boolean;
}

interface CargoDependencyMetadata {
	name: string;
	rename?: string | null;
	kind?: string | null;
	features?: string[];
}

interface CargoPackageMetadata {
	id: string;
	name: string;
	manifest_path: string;
	dependencies?: CargoDependencyMetadata[];
	features?: Record<string, string[]>;
}

interface CargoMetadata {
	packages: CargoPackageMetadata[];
	workspace_members: string[];
	workspace_default_members: string[];
	workspace_root: string;
}

interface DioxusPackageMetadata {
	packageMetadata: CargoPackageMetadata;
	dependencies: CargoDependencyMetadata[];
	dioxusDependencies: CargoDependencyMetadata[];
	manifestDirectory: string;
}

function isNormalDependency(dependency: CargoDependencyMetadata) {
	return dependency.kind === undefined || dependency.kind === null || dependency.kind === "normal";
}

function dependencyKey(dependency: CargoDependencyMetadata) {
	return dependency.rename || dependency.name;
}

function forwardedDioxusFeature(entry: string, dependencyKeys: Set<string>) {
	const separator = entry.indexOf("/");
	if (separator <= 0 || separator === entry.length - 1) return;
	const rawKey = entry.slice(0, separator);
	const key = rawKey.endsWith("?") ? rawKey.slice(0, -1) : rawKey;
	if (!dependencyKeys.has(key)) return;
	return entry.slice(separator + 1);
}

function collectDefaultDioxusFeatures(features: Record<string, string[]>, dependencyKeys: Set<string>) {
	const collected = new Set<string>();
	const visited = new Set<string>();
	const visit = (feature: string) => {
		if (visited.has(feature)) return;
		visited.add(feature);
		for (const entry of features[feature] ?? []) {
			const forwarded = forwardedDioxusFeature(entry, dependencyKeys);
			if (forwarded) {
				collected.add(forwarded);
			} else if (!entry.startsWith("dep:") && !entry.includes("/")) {
				visit(entry);
			}
		}
	};
	visit("default");
	return collected;
}

function isPathInsideOrEqual(directory: string, path: string) {
	const relativePath = relative(directory, path);
	return (
		relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
}

function pathDepth(path: string) {
	return resolve(path).split(sep).filter(Boolean).length;
}

function collectDioxusPackages(metadata: CargoMetadata) {
	const workspaceMembers = new Set(metadata.workspace_members);
	const workspaceRoot = resolve(metadata.workspace_root);
	const packages: DioxusPackageMetadata[] = [];
	for (const packageMetadata of metadata.packages) {
		if (!workspaceMembers.has(packageMetadata.id)) continue;
		const dependencies = (packageMetadata.dependencies ?? []).filter(isNormalDependency);
		const dioxusDependencies = dependencies.filter((dependency) => dependency.name === "dioxus");
		if (dioxusDependencies.length === 0) continue;
		packages.push({
			packageMetadata,
			dependencies,
			dioxusDependencies,
			manifestDirectory: dirname(resolve(workspaceRoot, packageMetadata.manifest_path)),
		});
	}
	return packages;
}

function selectDioxusPackage(
	packages: DioxusPackageMetadata[],
	metadata: CargoMetadata,
	cwd: string,
): DioxusPackageMetadata | undefined {
	const workspaceRoot = resolve(metadata.workspace_root);
	const resolvedCwd = resolve(workspaceRoot, cwd);
	const containingPackages = packages.filter((candidate) =>
		isPathInsideOrEqual(candidate.manifestDirectory, resolvedCwd),
	);
	if (containingPackages.length > 0) {
		const maximumDepth = Math.max(...containingPackages.map((candidate) => pathDepth(candidate.manifestDirectory)));
		const deepestPackages = containingPackages.filter(
			(candidate) => pathDepth(candidate.manifestDirectory) === maximumDepth,
		);
		return deepestPackages.length === 1 ? deepestPackages[0] : undefined;
	}

	const defaultMembers = new Set(metadata.workspace_default_members);
	const defaultPackages = packages.filter((candidate) => defaultMembers.has(candidate.packageMetadata.id));
	if (defaultPackages.length === 1) return defaultPackages[0];
	return packages.length === 1 ? packages[0] : undefined;
}

export function parseDioxusMetadata(
	metadata: CargoMetadata,
	cwd: string = metadata.workspace_root,
): DioxusFacts | undefined {
	const packages = collectDioxusPackages(metadata);
	if (packages.length === 0) return;
	const selectedPackage = selectDioxusPackage(packages, metadata, cwd);
	if (!selectedPackage) return { platforms: [], fullstack: false, router: false };

	const dependencyKeys = new Set(selectedPackage.dioxusDependencies.map(dependencyKey));
	const capabilities = new Set(selectedPackage.dioxusDependencies.flatMap((dependency) => dependency.features ?? []));
	for (const feature of collectDefaultDioxusFeatures(selectedPackage.packageMetadata.features ?? {}, dependencyKeys)) {
		capabilities.add(feature);
	}

	return {
		platforms: DIOXUS_PLATFORMS.filter((platform) => capabilities.has(platform)),
		fullstack: capabilities.has("fullstack"),
		router:
			selectedPackage.dependencies.some((dependency) => dependency.name === "dioxus-router") ||
			capabilities.has("router"),
	};
}

function errorDetail(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export default async function loadDioxusFacts(input: {
	cwd: string;
	signal: AbortSignal;
}): Promise<DioxusFacts | undefined> {
	input.signal.throwIfAborted();
	let stdout: string;
	try {
		({ stdout } = await execFileAsync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
			cwd: input.cwd,
			encoding: "utf8",
			maxBuffer: MAX_METADATA_BYTES,
			signal: input.signal,
		}));
	} catch (error) {
		input.signal.throwIfAborted();
		const processError = error as Error & { code?: string | number; stderr?: string };
		if (processError.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
			throw new Error(`Cargo metadata output exceeds ${MAX_METADATA_BYTES / (1024 * 1024)}MB.`, { cause: error });
		}
		if (typeof processError.code === "number") {
			const detail = processError.stderr?.trim() || processError.message;
			throw new Error(`Cargo metadata exited with code ${processError.code}: ${detail}`, { cause: error });
		}
		throw new Error(`Could not start Cargo metadata: ${errorDetail(error)}`, { cause: error });
	}
	input.signal.throwIfAborted();

	let metadata: CargoMetadata;
	try {
		metadata = JSON.parse(stdout) as CargoMetadata;
	} catch (error) {
		throw new Error(`Could not parse Cargo metadata JSON: ${errorDetail(error)}`, { cause: error });
	}
	return parseDioxusMetadata(metadata, input.cwd);
}

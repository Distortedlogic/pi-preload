import { execFile } from "node:child_process";
import { promisify } from "node:util";

const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const DIOXUS_PLATFORMS = ["desktop", "mobile", "native", "server", "web"] as const;
const execFileAsync = promisify(execFile);

type DioxusPlatform = (typeof DIOXUS_PLATFORMS)[number];

export interface DioxusFacts {
	packageNames: string[];
	versionRequirements: string[];
	declaredFeatures: string[];
	forwardedFeatures: string[];
	defaultFeatures: string[];
	platforms: DioxusPlatform[];
	fullstack: boolean;
	router: boolean;
}

interface CargoDependencyMetadata {
	name: string;
	rename?: string | null;
	req?: string;
	kind?: string | null;
	features?: string[];
	optional?: boolean;
	target?: string | null;
}

interface CargoPackageMetadata {
	id: string;
	name: string;
	dependencies?: CargoDependencyMetadata[];
	features?: Record<string, string[]>;
}

interface CargoMetadata {
	packages: CargoPackageMetadata[];
	workspace_members: string[];
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

function sorted(values: Set<string>) {
	return [...values].sort();
}

export function parseDioxusMetadata(metadata: CargoMetadata): DioxusFacts | undefined {
	const workspaceMembers = new Set(metadata.workspace_members);
	const packageNames = new Set<string>();
	const versionRequirements = new Set<string>();
	const declaredFeatures = new Set<string>();
	const forwardedFeatures = new Set<string>();
	const defaultFeatures = new Set<string>();
	let hasRouterDependency = false;

	for (const packageMetadata of metadata.packages) {
		if (!workspaceMembers.has(packageMetadata.id)) continue;
		const dependencies = (packageMetadata.dependencies ?? []).filter(isNormalDependency);
		if (dependencies.some((dependency) => dependency.name === "dioxus-router")) {
			hasRouterDependency = true;
		}

		const dioxusDependencies = dependencies.filter((dependency) => dependency.name === "dioxus");
		if (dioxusDependencies.length === 0) continue;
		packageNames.add(packageMetadata.name);

		const dependencyKeys = new Set(dioxusDependencies.map(dependencyKey));
		for (const dependency of dioxusDependencies) {
			if (dependency.req) versionRequirements.add(dependency.req);
			for (const feature of dependency.features ?? []) declaredFeatures.add(feature);
		}

		const packageFeatures = packageMetadata.features ?? {};
		for (const entries of Object.values(packageFeatures)) {
			for (const entry of entries) {
				const forwarded = forwardedDioxusFeature(entry, dependencyKeys);
				if (forwarded) forwardedFeatures.add(forwarded);
			}
		}
		for (const feature of collectDefaultDioxusFeatures(packageFeatures, dependencyKeys)) {
			defaultFeatures.add(feature);
		}
	}

	if (packageNames.size === 0) return;
	const capabilities = new Set([...declaredFeatures, ...forwardedFeatures, ...defaultFeatures]);
	return {
		packageNames: sorted(packageNames),
		versionRequirements: sorted(versionRequirements),
		declaredFeatures: sorted(declaredFeatures),
		forwardedFeatures: sorted(forwardedFeatures),
		defaultFeatures: sorted(defaultFeatures),
		platforms: DIOXUS_PLATFORMS.filter((platform) => capabilities.has(platform)),
		fullstack: capabilities.has("fullstack"),
		router: hasRouterDependency || capabilities.has("router"),
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
	return parseDioxusMetadata(metadata);
}

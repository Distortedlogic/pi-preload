import { type Static, Type } from "typebox";

const GLOB_LIST = Type.Array(Type.String({ minLength: 1 }));

export const agentsSection = {
	key: "pi-context-preload",
	schema: Type.Object(
		{
			extends: Type.Optional(GLOB_LIST),
			files: Type.Optional(GLOB_LIST),
			contexts: Type.Optional(GLOB_LIST),
		},
		{ additionalProperties: false },
	),
} as const;

export type ContextPreloadConfiguration = Static<typeof agentsSection.schema>;

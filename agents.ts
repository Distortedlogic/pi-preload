import { type Static, Type } from "typebox";

const GLOB_LIST = Type.Array(Type.String({ minLength: 1 }));

export const configurationSchema = Type.Object(
	{
		extends: Type.Optional(GLOB_LIST),
		files: Type.Optional(GLOB_LIST),
		contexts: Type.Optional(GLOB_LIST),
	},
	{ additionalProperties: false },
);

export type Configuration = Static<typeof configurationSchema>;

export const agentsSection = {
	"pi-context-preload": Type.Optional(configurationSchema),
} as const;

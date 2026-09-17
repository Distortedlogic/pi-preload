import { type Static, Type } from "typebox";

const GLOB_LIST = Type.Array(Type.String({ minLength: 1 }));

export const configurationSchema = Type.Object(
	{
		extends: Type.Optional(GLOB_LIST),
		presets: Type.Optional(GLOB_LIST),
		includes: Type.Optional(GLOB_LIST),
		excludes: Type.Optional(GLOB_LIST),
		contexts: Type.Optional(GLOB_LIST),
	},
	{ additionalProperties: false },
);

export type Configuration = Static<typeof configurationSchema>;

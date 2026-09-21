import { type Static, Type } from "typebox";

const STRING_LIST_SCHEMA = Type.Array(Type.String({ minLength: 1 }));

export const configurationSchema = Type.Object(
	{
		extends: Type.Optional(STRING_LIST_SCHEMA),
		presets: Type.Optional(STRING_LIST_SCHEMA),
		includes: Type.Optional(STRING_LIST_SCHEMA),
		signatures: Type.Optional(STRING_LIST_SCHEMA),
		excludes: Type.Optional(STRING_LIST_SCHEMA),
		contexts: Type.Optional(STRING_LIST_SCHEMA),
	},
	{ additionalProperties: false },
);

export type Configuration = Static<typeof configurationSchema>;

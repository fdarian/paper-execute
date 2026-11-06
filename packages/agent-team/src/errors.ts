import { Schema } from "effect";

export class AgentTeamConfigError extends Schema.TaggedError<AgentTeamConfigError>()(
	"AgentTeamConfigError",
	{
		reason: Schema.String,
	},
) {}

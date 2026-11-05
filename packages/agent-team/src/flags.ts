import { Argument, Flag } from "effect/unstable/cli";

export const cacheTtlFlag = Flag.optional(Flag.Literals("cache-ttl", ["5m", "1h"])).pipe(
	Flag.withDescription(
		"Prompt cache TTL for the main agent and its subagents (5m or 1h); e.g. 5m when the team is driven by another agent. Default: Claude Code's automatic choice",
	),
);

// Effect CLI rejects unknown flags, so claude's own flags (other than -c / -r) must follow `--`.
// Effect CLI has no optional-value flags, so `-r` is boolean and its session id arrives as the first positional.
export const ccFlags = {
	continue: Flag.Boolean("continue").pipe(
		Flag.withAlias("c"),
		Flag.withDefault(false),
		Flag.withDescription("Continue the most recent conversation"),
	),
	resume: Flag.Boolean("resume").pipe(
		Flag.withAlias("r"),
		Flag.withDefault(false),
		Flag.withDescription("Resume a conversation: `-r <id>`, or `-r` alone for the picker"),
	),
	args: Argument.String("args").pipe(Argument.variadic()),
};

import type { AppConfig } from "@biliLive-tools/types";

export interface SummaryOverrideContext {
  streamer?: string;
  roomId?: string;
}

type StreamerOverride = {
  streamer?: string;
  roomId?: string;
};

function normalizeMatcherValue(value?: string) {
  return value?.trim() || "";
}

export function findStreamerOverride<T extends StreamerOverride>(
  overrides: T[] | undefined,
  input: SummaryOverrideContext,
  isEnabled?: (override: T) => boolean,
) {
  const roomId = normalizeMatcherValue(input.roomId);
  const streamer = normalizeMatcherValue(input.streamer);
  const candidates = isEnabled ? overrides?.filter(isEnabled) : overrides;
  if (!candidates?.length) return undefined;

  if (roomId) {
    const roomMatch = candidates.find(
      (override) => normalizeMatcherValue(override.roomId) === roomId,
    );
    if (roomMatch) return roomMatch;
  }

  if (!streamer) return undefined;
  return candidates.find(
    (override) =>
      !normalizeMatcherValue(override.roomId) &&
      normalizeMatcherValue(override.streamer) === streamer,
  );
}

export function resolveLiveSummaryPrompt(
  config: AppConfig["ai"]["liveSummary"],
  input: SummaryOverrideContext,
  customPrompt?: string,
) {
  const oneTimePrompt = customPrompt?.trim();
  if (oneTimePrompt) return oneTimePrompt;

  const override = findStreamerOverride(
    config.promptOverrides,
    input,
    (item) => !!item.prompt?.trim(),
  );
  return override?.prompt?.trim() || config.prompt;
}

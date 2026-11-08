import { validateCampaign, type Campaign } from "./demo-campaign.js";
/** Administrative observer-only plan. Never supplies observations to the body. */
export function spectatorCommands(
  campaign: Campaign,
  scenario: "north" | "west",
  runId: string,
  observer: string,
) {
  validateCampaign(campaign);
  if (!campaign.liveAuthorized || campaign.attempts[scenario]?.runId !== runId)
    throw Error("camera_campaign_mismatch");
  const bot = `Demo02_${scenario}`;
  if (
    !/^[A-Za-z0-9_]{1,16}$/.test(observer) ||
    observer.toLowerCase().startsWith("demo02_")
  )
    throw Error("independent_observer_required");
  return {
    campaignId: campaign.campaignId,
    runId,
    observer,
    bot,
    setup: [`gamemode spectator ${observer}`, `spectate ${bot} ${observer}`],
    restore: [`gamemode survival ${observer}`],
    graphicalViewVerified: false as const,
  };
}

// SaaS plans & limits (server-side source of truth)
// Credits model: 1 delivery = 1 credit

export type PlanId = "basic" | "pro" | "enterprise";

export type PlanLimits = {
  id: PlanId;
  displayName: string;
  monthlyPrice: number;
  dailyCredits: number;
  maxRecipientsPerSend: number;
  maxUsers: number;
  whiteLabel: boolean;

  // Upload limits
  maxFileSizeBytes: number;
  maxTotalAttachmentBytes: number;

  // Attachment count limits per message
  maxImagesPerMessage: number;
  maxVideosPerMessage: number;
};

export const PLANS: Record<PlanId, PlanLimits> = {
  basic: {
    id: "basic",
    displayName: "Starter",
    monthlyPrice: 30,
    dailyCredits: 2000,
    maxRecipientsPerSend: 400,
    maxUsers: 1000,
    whiteLabel: false,
    maxFileSizeBytes: 40 * 1024 * 1024,
    maxTotalAttachmentBytes: 100 * 1024 * 1024,
    maxImagesPerMessage: 24,
    maxVideosPerMessage: 6,
  },
  pro: {
    id: "pro",
    displayName: "Pro",
    monthlyPrice: 50,
    dailyCredits: 6000,
    maxRecipientsPerSend: 1000,
    maxUsers: 4000,
    whiteLabel: true,
    maxFileSizeBytes: 100 * 1024 * 1024,
    maxTotalAttachmentBytes: 200 * 1024 * 1024,
    maxImagesPerMessage: 40,
    maxVideosPerMessage: 10,
  },
  enterprise: {
    id: "enterprise",
    displayName: "Business",
    monthlyPrice: 80,
    dailyCredits: 12000,
    maxRecipientsPerSend: 2000,
    maxUsers: 20000,
    whiteLabel: true,
    maxFileSizeBytes: 200 * 1024 * 1024,
    maxTotalAttachmentBytes: 600 * 1024 * 1024,
    maxImagesPerMessage: 70,
    maxVideosPerMessage: 16,
  },
};

export const EXTRA_CREDIT_PACKS = [
  { id: "extra-1000", credits: 1000, price: 15 },
  { id: "extra-3000", credits: 3000, price: 35 },
  { id: "extra-5000", credits: 5000, price: 50 },
] as const;

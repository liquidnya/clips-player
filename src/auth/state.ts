import { z } from "zod";

const DeviceFlowStateSchema = z.object({
  token: z.object({
    accessToken: z.string(),
    refreshToken: z.string().nullable(),
    scope: z.string().array(),
    expiresIn: z.number().nullable(),
    obtainmentTimestamp: z.number(),
  }),
  intents: z.string().array(),
  lastVerified: z.number().nullable(),
  userId: z.string(),
  error: z
    .object({
      message: z.string(),
      stack: z.string().optional(),
      count: z.number(),
      time: z.number(),
      id: z.string(),
      forceRefresh: z.boolean(),
    })
    .nullable(),
});

export type DeviceFlowState = z.output<typeof DeviceFlowStateSchema>;

export default DeviceFlowStateSchema;

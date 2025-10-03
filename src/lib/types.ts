import { InferUITools, UIMessage, UIDataTypes } from "ai";
import { researchTools } from "./tools";

// Infer the types from our everything tools
export type HealthcareUITools = InferUITools<typeof researchTools>;

// Create a custom UIMessage type with our tools
export type HealthcareUIMessage = UIMessage<
  never,
  UIDataTypes,
  HealthcareUITools
>;


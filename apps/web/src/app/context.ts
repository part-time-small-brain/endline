import { createContext, useContext } from "react";
import type { Config } from "../config.ts";
import type { Services } from "../services.ts";

export const AppContext = createContext<{ config: Config; services: Services } | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppContext missing");
  return value;
}

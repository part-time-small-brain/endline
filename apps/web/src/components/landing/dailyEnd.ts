import { EXPIRY_TIME_OF_DAY, SECONDS_PER_DAY } from "@near-options/sdk";

export const nextDailyEnd = (nowSec: number) => Math.ceil((nowSec - EXPIRY_TIME_OF_DAY) / SECONDS_PER_DAY) * SECONDS_PER_DAY + EXPIRY_TIME_OF_DAY;

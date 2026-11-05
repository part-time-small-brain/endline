import { index } from "@/lib/llms";

export const revalidate = false;

export function GET() {
  return new Response(index());
}

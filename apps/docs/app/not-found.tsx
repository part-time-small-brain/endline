import { HomeLayout } from "fumadocs-ui/layouts/home";
import { DefaultNotFound } from "fumadocs-ui/layouts/home/not-found";
import { baseOptions } from "@/lib/layout";

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions}>
      <DefaultNotFound />
    </HomeLayout>
  );
}

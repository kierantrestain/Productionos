import { requirePageContext } from "@/server/auth/request";
import { myWork } from "@/server/hub/hub";
import { MyWorkView } from "@/components/hub/my-work";

export const metadata = { title: "My work" };
export default async function MyWorkPage() {
  const ctx = await requirePageContext();
  const w = await myWork(ctx);
  return <MyWorkView name={ctx.name.split(" ")[0]} data={w} />;
}

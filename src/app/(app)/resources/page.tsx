import { requirePageContext } from "@/server/auth/request";
import { Workspace } from "@/components/workspace";
import type { SP } from "@/components/entity-view";

export const metadata = { title: "Locations, equipment & resources" };

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  return <Workspace ctx={ctx} sp={sp} base="/resources" title="Locations, equipment & resources" lede="Shared locations, studios, props, wardrobe and kit — booked per production with double-booking detection." tabs={[
    { key: "locations", label: "Locations & studios", entity: "locations" },
    { key: "props", label: "Props", entity: "resources", fixed: { kind: "prop" } },
    { key: "wardrobe", label: "Wardrobe", entity: "resources", fixed: { kind: "wardrobe" } },
    { key: "equipment", label: "Equipment", entity: "resources", fixed: { kind: "equipment" } },
    { key: "sets", label: "Sets & graphics", entity: "resources", fixed: { kind: "set" } },
    { key: "bookings", label: "Kit bookings", entity: "resource_bookings" },
    { key: "location_bookings", label: "Location & studio bookings", entity: "location_bookings" },
    { key: "checkouts", label: "Check-out / in", entity: "resource_checkouts" },
    { key: "transport", label: "Transport", entity: "transport_bookings" },
    { key: "catering", label: "Catering", entity: "catering_orders" },
  ]} />;
}

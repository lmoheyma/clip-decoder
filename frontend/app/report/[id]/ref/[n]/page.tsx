import { notFound } from "next/navigation";
import { fetchReportServer } from "@/lib/api-server";
import { ReferenceDetail } from "@/components/report/detail/ReferenceDetail";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; n: string }>;
}) {
  const { id, n } = await params;
  const idx = Number.parseInt(n, 10);
  if (Number.isNaN(idx) || idx < 0) notFound();
  const report = await fetchReportServer(id);
  if (!report || idx >= report.references.length) notFound();
  return <ReferenceDetail report={report} index={idx} />;
}

import { NextResponse } from "next/server";
import { getAdminSession } from "@/app/actions";
import { proposeAosRecommendationToCore } from "@/services/aosV2ProposalService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session.isSuperadmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 403 });
  }

  const { id } = params;
  const result = await proposeAosRecommendationToCore(id);
  if (!result.ok) {
    const status = result.code.endsWith("DISABLED") ? 409 : 400;
    return NextResponse.json({ ok: false, error: result.code }, { status });
  }

  return NextResponse.json(result, { status: 202 });
}

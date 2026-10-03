import { getAdminSession } from "@/app/actions";
import { updateAarohiRuntimeControlAction } from "@/app/admin/aarohi/actions";
import {
  AarohiBadge,
  AarohiPageHead,
} from "@/components/admin/aarohi/AarohiPrimitives";
import { aarohiPermissionsForRole } from "@/lib/aarohi/permissions";
import { listActiveAarohiCities } from "@/services/aarohiCrmService";
import { getAarohiRuntimeControl } from "@/services/aarohiPhase2OpsService";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [session, cities, control] = await Promise.all([
    getAdminSession(),
    listActiveAarohiCities(),
    getAarohiRuntimeControl(),
  ]);
  const perms = [...aarohiPermissionsForRole(session.adminRole)];
  const tone =
    control.mode === "PAUSED" || control.provider_incident_mode
      ? "hot"
      : control.mode === "GOVERNED_AUTOMATION"
        ? "good"
        : "warn";
  return (
    <>
      <AarohiPageHead
        title="Settings & authority"
        description="Core-owned kill switches and authority boundaries. Environment/provider gates remain independently fail-closed."
      />
      <div className="qf-aarohi-grid2">
        <section className="qf-aarohi-panel">
          <div className="qf-aarohi-panel-head">
            <div>
              <h2>Global Aarohi runtime</h2>
              <p>
                These controls cannot enable provider execution by themselves.
              </p>
            </div>
            <AarohiBadge tone={tone}>{control.mode}</AarohiBadge>
          </div>
          <form
            action={updateAarohiRuntimeControlAction}
            className="qf-aarohi-formgrid"
          >
            <label>
              Mode
              <select
                name="mode"
                className="qf-aarohi-select"
                defaultValue={control.mode}
              >
                <option>PAUSED</option>
                <option>INBOUND_ONLY</option>
                <option>ASSISTED_ONLY</option>
                <option>GOVERNED_AUTOMATION</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                name="provider_incident_mode"
                defaultChecked={control.provider_incident_mode}
              />{" "}
              provider incident mode
            </label>
            <label>
              <input
                type="checkbox"
                name="discovery_enabled"
                defaultChecked={control.discovery_enabled}
              />{" "}
              discovery
            </label>
            <label>
              <input
                type="checkbox"
                name="outbound_enabled"
                defaultChecked={control.outbound_enabled}
              />{" "}
              outbound
            </label>
            <label>
              <input
                type="checkbox"
                name="broadcasts_enabled"
                defaultChecked={control.broadcasts_enabled}
              />{" "}
              broadcasts
            </label>
            <label>
              <input
                type="checkbox"
                name="followups_enabled"
                defaultChecked={control.followups_enabled}
              />{" "}
              follow-ups
            </label>
            <label>
              <input
                type="checkbox"
                name="whatsapp_enabled"
                defaultChecked={control.whatsapp_enabled}
              />{" "}
              WhatsApp
            </label>
            <label>
              <input
                type="checkbox"
                name="instagram_enabled"
                defaultChecked={control.instagram_enabled}
              />{" "}
              Instagram
            </label>
            <label>
              <input
                type="checkbox"
                name="facebook_enabled"
                defaultChecked={control.facebook_enabled}
              />{" "}
              Facebook
            </label>
            <label>
              <input
                type="checkbox"
                name="x_enabled"
                defaultChecked={control.x_enabled}
              />{" "}
              X
            </label>
            <label className="wide">
              Change reason
              <input
                name="reason"
                className="qf-aarohi-input"
                defaultValue={control.reason ?? ""}
              />
            </label>
            <button className="qf-aarohi-btn" data-tone="primary">
              Save runtime controls
            </button>
          </form>
          <p className="qf-aarohi-note">
            PAUSED forces every execution flag off. Database guards also reject
            discovery claims, automated dispatch and assisted first-contact
            transitions when the matching control is disabled.
          </p>
        </section>
        <section className="qf-aarohi-panel">
          <div className="qf-aarohi-panel-head">
            <div>
              <h2>Your Aarohi permissions</h2>
              <p>
                Derived server-side from the trusted QuickFurno admin session.
              </p>
            </div>
          </div>
          <div className="qf-aarohi-cardmeta">
            {perms.map((p) => (
              <AarohiBadge key={p} tone="good">
                {p}
              </AarohiBadge>
            ))}
          </div>
          <div className="qf-aarohi-panel-head" style={{ marginTop: 16 }}>
            <div>
              <h2>Active acquisition markets</h2>
              <p>
                Canonical cities only; Phase-2 city policy still controls each
                market independently.
              </p>
            </div>
          </div>
          <div className="qf-aarohi-cardmeta">
            {cities.map((c: any) => (
              <AarohiBadge key={c.id} tone="good">
                {c.name}
              </AarohiBadge>
            ))}
          </div>
        </section>
      </div>
      <section className="qf-aarohi-panel" style={{ marginTop: 14 }}>
        <div className="qf-aarohi-panel-head">
          <div>
            <h2>Authority boundaries</h2>
          </div>
        </div>
        <dl className="qf-aarohi-profile-list">
          <dt>Prospect discovery</dt>
          <dd>Aarohi CRM projection under global + city + connector policy.</dd>
          <dt>Social first contact</dt>
          <dd>
            Instagram/Facebook assisted only; X only with current eligibility.
          </dd>
          <dt>WhatsApp</dt>
          <dd>
            Core permission + frequency + capacity + city + global controls +
            provider gate.
          </dd>
          <dt>Package/payment/activation</dt>
          <dd>Canonical QuickFurno Core only.</dd>
          <dt>Provider secrets</dt>
          <dd>Never stored in Aarohi CRM/control tables.</dd>
          <dt>Post-acquisition</dt>
          <dd>Handoff to Anisha after canonical activation facts.</dd>
        </dl>
      </section>
    </>
  );
}

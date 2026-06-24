import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { VendorRegisterForm } from "@/components/VendorRegisterForm";

export const metadata = { title: "Become a partner — QuickFurno" };

const trustBullets = [
  "Verified vendor profile",
  "Area-based enquiry matching",
  "Dashboard access after approval",
  "WhatsApp-first communication",
];

export default function VendorRegisterPage() {
  return (
    <>
      <Header />
      <section className="qf-vendor-intro">
        <span className="qf-vendor-badge">Partner with QuickFurno</span>
        <h1 className="qf-vendor-intro-title">
          Get verified and start receiving serious home-service enquiries
        </h1>
        <p className="qf-vendor-intro-sub">
          Join QuickFurno as a verified vendor. Share your business details once, choose your
          service areas, and our team will review your profile before giving access to suitable
          client enquiries.
        </p>
        <ul className="qf-vendor-bullets">
          {trustBullets.map((bullet) => (
            <li key={bullet}>
              <span className="qf-vendor-bullet-check" aria-hidden="true">✓</span>
              {bullet}
            </li>
          ))}
        </ul>
      </section>
      <section className="qf-vendor-form-wrap">
        <VendorRegisterForm />
      </section>
      <Footer />
    </>
  );
}

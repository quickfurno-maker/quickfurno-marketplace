import Image from "next/image";

const LAUNCH_IMG = "/assets/quickfurno/images/launch";

const CITIES = [
  { name: "Pune", file: "pune", live: true },
  { name: "Delhi NCR", file: "delhi-ncr", live: false },
  { name: "Mumbai", file: "mumbai", live: false },
  { name: "Hyderabad", file: "hyderabad", live: false },
  { name: "Kolkata", file: "kolkata", live: false },
  { name: "Bengaluru", file: "bengaluru", live: false },
] as const;

/**
 * Shared public "Our journey" section.
 *
 * The homepage is the design authority for this band. /vendors imports the
 * same component instead of maintaining a second city-card implementation, so
 * mobile/desktop scale, spacing and future changes cannot drift apart.
 */
export function MadeInPune() {
  return (
    <section className="qfp-page qfp-section qfp-cities qfp2-cities" aria-labelledby="qfp-cities-title">
      <span className="qfp-cities-glow" aria-hidden="true" />
      <div className="qfp-shell">
        <div className="qfp-head-center" data-reveal>
          <span className="qfp-kicker qfp-kicker--coral">Our journey</span>
          <h2 id="qfp-cities-title">Made in Pune. <span>Coming to your city next.</span></h2>
          <p className="qfp-cities-lead">
            We are building QuickFurno where we live — then bringing verified home professionals to more of India.
          </p>
        </div>
        <ul className="qfp-city-grid" data-reveal-group>
          {CITIES.map((city) => (
            <li className="qfp-city" key={city.name}>
              <span className="qfp-city-badge">
                <Image src={`${LAUNCH_IMG}/cities/${city.file}.jpg`} alt="" fill sizes="104px" />
              </span>
              <strong>{city.name}</strong>
              {city.live ? (
                <span className="qfp-city-status qfp-city-status--live">
                  <i aria-hidden="true" />
                  Live now
                </span>
              ) : (
                <span className="qfp-city-status">Coming soon</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

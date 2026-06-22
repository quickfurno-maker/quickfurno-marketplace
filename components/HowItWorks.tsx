const steps = [
  {
    number: "01",
    title: "Share your requirement",
    description: "Tell QuickFurno your city, service, budget and project details.",
  },
  {
    number: "02",
    title: "We verify the fit",
    description: "Your enquiry is matched by service category, city, response quality and vendor profile.",
  },
  {
    number: "03",
    title: "Compare clear profiles",
    description: "Review rates, ratings, reviews, experience and project focus before you speak.",
  },
  {
    number: "04",
    title: "Choose with confidence",
    description: "Speak directly with shortlisted vendors and move forward only when you are ready.",
  },
];

export function HowItWorks() {
  return (
    <div className="steps-grid" data-reveal-group>
      {steps.map((step) => (
        <article className="step-card" key={step.number}>
          <span>{step.number}</span>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
        </article>
      ))}
    </div>
  );
}

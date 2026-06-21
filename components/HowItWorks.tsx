const steps = [
  {
    number: "01",
    title: "Share your requirement",
    description: "Tell QuickFurno your city, service, budget and project details.",
  },
  {
    number: "02",
    title: "Get matched with 4 verified vendors",
    description: "We shortlist relevant active vendors based on category and city.",
  },
  {
    number: "03",
    title: "Compare rates, ratings and project work",
    description: "Review profiles, starting rates, response time and project galleries.",
  },
  {
    number: "04",
    title: "Choose the best expert",
    description: "Speak directly, compare quotes and start your home project confidently.",
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

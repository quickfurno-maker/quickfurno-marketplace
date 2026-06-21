"use client";

import { useState } from "react";

export type FaqItem = {
  question: string;
  answer: string;
};

export function FAQ({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="faq-list">
      {items.map((item, index) => {
        const isOpen = index === openIndex;
        return (
          <div className="faq-item" key={item.question}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`faq-panel-${index}`}
              onClick={() => setOpenIndex(isOpen ? -1 : index)}
            >
              <span>{item.question}</span>
              <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
            </button>
            <div id={`faq-panel-${index}`} className={`faq-answer ${isOpen ? "faq-answer--open" : ""}`}>
              <p>{item.answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

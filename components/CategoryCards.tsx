import Link from "next/link";
import { categories } from "@/lib/quickfurno-data";

export function CategoryCards() {
  return (
    <div className="category-grid" data-reveal-group>
      {categories.map((category) => (
        <article className="category-card" key={category.name}>
          <div className="category-icon" aria-hidden="true">
            {category.icon}
          </div>
          <div>
            <h3>{category.name}</h3>
            <p>{category.description}</p>
            <strong>{category.startingPrice}</strong>
          </div>
          <Link href={`/#verified-vendors`} className="card-link">
            View Vendors
          </Link>
        </article>
      ))}
    </div>
  );
}

import Image from "next/image";
import Link from "next/link";
import { categories, categorySlug } from "@/lib/quickfurno-data";
import { categoryImage } from "@/lib/images";

export function CategoryCards() {
  return (
    <div className="category-grid" data-reveal-group>
      {categories.map((category) => (
        <Link
          href={`/category/${categorySlug(category.name)}`}
          className="category-card"
          key={category.name}
        >
          <div className="cat-card-media">
            <Image
              src={categoryImage(category.name)}
              alt={`${category.name} projects on QuickFurno`}
              fill
              sizes="(max-width: 560px) 100vw, (max-width: 980px) 50vw, 300px"
              className="cat-card-img"
            />
            <span className="cat-card-shade" aria-hidden="true" />
            <span className="cat-card-icon" aria-hidden="true">
              {category.icon}
            </span>
            <span className="cat-card-tag">Verified</span>
          </div>
          <div className="cat-card-body">
            <h3>{category.name}</h3>
            <p>{category.description}</p>
            <div className="cat-card-foot">
              <strong>{category.startingPrice}</strong>
              <span className="cat-card-cta">View Vendors →</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

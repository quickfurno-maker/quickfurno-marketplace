import { portfolioProjects } from "@/lib/quickfurno-data";

export function PortfolioGallery({ limit = 20 }: { limit?: number }) {
  const projects = portfolioProjects.slice(0, limit);

  return (
    <div className="portfolio-grid" data-reveal-group>
      {/* Future integration: fetch image paths from vendor_project_images table and generate public URLs from Supabase Storage bucket vendor-projects. */}
      {projects.map((project) => (
        <article className="portfolio-card" key={project.id}>
          <div className={`portfolio-image ${project.imageTone}`} role="img" aria-label={`${project.title} project image placeholder`}>
            <span>{String(project.id).padStart(2, "0")}</span>
          </div>
          <div>
            <h3>{project.title}</h3>
            <p>{project.vendorName}</p>
            <span>{project.category} • {project.city}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

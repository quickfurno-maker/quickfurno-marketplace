// Registers the local integration resolve hook (see qfLocalIntegrationLoader.mjs).
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./qfLocalIntegrationLoader.mjs", pathToFileURL(import.meta.filename));

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normalizeGpsCoordinates,
  normalizeLeadLocationEvidence,
  normalizeVendorOfficeEvidence,
} from "../../../lib/locations/locationEvidence.ts";

const googleLead = normalizeLeadLocationEvidence({
  latitude: 18.559,
  longitude: 73.7868,
  location_source: "google_place",
  google_place_id: "place-123",
  formatted_address: "Baner, Pune, Maharashtra",
  area_normalized: "baner",
});
assert.equal(googleLead.location_source, "google_place");
assert.equal(googleLead.latitude, 18.559);
assert.equal(googleLead.longitude, 73.7868);
assert.equal(googleLead.google_place_id, "place-123");

const malformedGoogleLead = normalizeLeadLocationEvidence({
  latitude: 18.559,
  longitude: 73.7868,
  location_source: "google_place",
  google_place_id: "",
});
assert.equal(malformedGoogleLead.location_source, "manual");
assert.equal(malformedGoogleLead.latitude, null);
assert.equal(malformedGoogleLead.longitude, null);
assert.equal(malformedGoogleLead.google_place_id, null);

const gpsLead = normalizeLeadLocationEvidence({
  latitude: 18.5204,
  longitude: 73.8567,
  location_accuracy_meters: 12,
  location_source: "browser_gps",
  google_place_id: "stale-place",
  formatted_address: "stale address",
  area_normalized: "pune",
});
assert.equal(gpsLead.location_source, "browser_gps");
assert.equal(gpsLead.google_place_id, null);
assert.equal(gpsLead.formatted_address, null);
assert.equal(gpsLead.location_accuracy_meters, 12);

const invalidLead = normalizeLeadLocationEvidence({
  latitude: 181,
  longitude: 73.8,
  location_source: "browser_gps",
});
assert.equal(invalidLead.location_source, "manual");
assert.equal(invalidLead.latitude, null);

const verifiedOffice = normalizeVendorOfficeEvidence({
  office_latitude: 18.5679,
  office_longitude: 73.9143,
  google_place_id: "office-place",
  formatted_address: "Kharadi, Pune",
  area_normalized: "kharadi",
});
assert.equal(verifiedOffice.verified, true);
assert.equal(verifiedOffice.office_latitude, 18.5679);
assert.equal(verifiedOffice.google_place_id, "office-place");

const manualOffice = normalizeVendorOfficeEvidence({
  office_latitude: 18.5679,
  office_longitude: 73.9143,
  google_place_id: "",
  area_normalized: "kharadi",
});
assert.equal(manualOffice.verified, false);
assert.equal(manualOffice.office_latitude, null);
assert.equal(manualOffice.office_longitude, null);
assert.equal(manualOffice.google_place_id, null);
assert.equal(manualOffice.area_normalized, "kharadi");

assert.deepEqual(normalizeGpsCoordinates(18.52, 73.85), {
  latitude: 18.52,
  longitude: 73.85,
});
assert.deepEqual(normalizeGpsCoordinates(-91, 73.85), {
  latitude: null,
  longitude: null,
});

const client = fs.readFileSync("components/ClientEnquiryModal.tsx", "utf8");
assert.match(client, /value=\{form\.formattedAddress \|\| form\.area\}/);
assert.match(client, /mode="address"/);
assert.match(client, /googlePlaceId: "",\s+formattedAddress: "",\s+sublocality: "",\s+neighborhood: ""/s);

const vendor = fs.readFileSync("components/VendorRegisterForm.tsx", "utf8");
assert.match(vendor, /value=\{f\.formattedAddress \|\| f\.baseArea\}/);
assert.match(vendor, /mode="address"/);
assert.match(vendor, /Exact office location verified for precise nearby-client matching/);
assert.match(vendor, /addressLine1: place\.formattedAddress \?\? current\.addressLine1/);

console.log("Precise client/vendor location capture: PASS");

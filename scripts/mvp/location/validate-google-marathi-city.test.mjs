import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGooglePlace, isPlaceCompatibleWithSelectedCity } from "../../../lib/google-maps/normalizePlace.ts";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const pune = ["Pune","Pimpri-Chinchwad","Pimpri Chinchwad","PCMC"];
const place = (city, address) => ({city,formattedAddress:address});
const marathiKunal = {
 id:"ChIJtestBavdhan",
 displayName:"Kunal Belleza",
 formattedAddress:"कुनाल बेलेजा, बावधन, पुणे, महाराष्ट्र, भारत",
 addressComponents:[
  {types:["locality"],longText:"पुणे"},
  {types:["administrative_area_level_1"],longText:"महाराष्ट्र"},
 ],
 location:{lat:18.515,lng:73.78},
};

test("PUNE-01 reproduced failure: real Google Marathi locality पुणे resolves against admin-active Pune",()=>{
 const normalized=normalizeGooglePlace(marathiKunal,"address");
 assert.equal(normalized.city,"पुणे");
 assert.equal(normalized.placeId,"ChIJtestBavdhan");
 assert.equal(normalized.area,"Kunal Belleza");
 assert.equal(isPlaceCompatibleWithSelectedCity(normalized,"Pune",pune),true);
});

test("PUNE-02 exact Marathi city alias is accepted with Pune active, without adding Mumbai",()=>{
 assert.equal(isPlaceCompatibleWithSelectedCity(place("पुणे","बावधन, पुणे"),"Pune",pune),true);
 assert.equal(isPlaceCompatibleWithSelectedCity(place("पुणे","बावधन, पुणे"),"Mumbai",["Mumbai"]),false);
});

test("PUNE-03 Unicode address token may show city when address component is absent",()=>{
 assert.equal(isPlaceCompatibleWithSelectedCity(place(null,"कुनाल बेलेजा, बावधन, पुणे, महाराष्ट्र"),"Pune",pune),true);
});

test("PUNE-04 ASCII Pune, PCMC and existing aliases still work",()=>{
 assert.equal(isPlaceCompatibleWithSelectedCity(place("Pune","Bavdhan Pune"),"Pune",pune),true);
 assert.equal(isPlaceCompatibleWithSelectedCity(place("PCMC","Chinchwad"),"Pune",pune),true);
 assert.equal(isPlaceCompatibleWithSelectedCity(place("Pimpri-Chinchwad","Pimpri"),"Pune",pune),true);
});

test("PUNE-05 reject other city labels, English/Marathi and misleading fragments",()=>{
 for(const bad of [
  place("मुंबई","अंधेरी, मुंबई"),place("नाशिक","नाशिक, महाराष्ट्र"),
  place("Nagpur","Nagpur, Maharashtra"),place("New Delhi","Delhi"),
  place("punexyz","punexyz"),place("पुणेकर","पुणेकर, महाराष्ट्र"),
 ]){
  assert.equal(isPlaceCompatibleWithSelectedCity(bad,"Pune",pune),false,JSON.stringify(bad));
 }
});

test("PUNE-06 config aliases alone are authoritative for additional noncanonical markets",()=>{
 assert.equal(isPlaceCompatibleWithSelectedCity(place("एक_कस्टम_शहर","district"),"ExampleCity",["ExampleCity"]),false);
 assert.equal(isPlaceCompatibleWithSelectedCity(place("एक_कस्टम_शहर","district"),"ExampleCity",["ExampleCity","एक_कस्टम_शहर"]),true);
});

test("PUNE-07 provider needs Google-selected place identity and no public free-text bypass",()=>{
 const file=readFileSync(resolve("components/location/ProjectLocationProvider.tsx"),"utf8");
 assert.match(file,/if \(!place\.placeId \|\| place\.lat == null \|\| place\.lng == null\)/);
 assert.match(file,/onPlaceSelected=\{choosePlace\}/);
 assert.doesNotMatch(file,/manualLocation\s*\?\s*makeProjectLocation/);
});

test("PUNE-08 admin city state remains authoritative and alias matching cannot create city",()=>{
 const file=readFileSync(resolve("components/location/ProjectLocationProvider.tsx"),"utf8");
 assert.match(file,/records\.find\(\(record\) =>/);
 assert.match(file,/isPlaceCompatibleWithSelectedCity/);
 assert.match(file,/QuickFurno isn't serving/);
});

import test from "node:test";import assert from "node:assert/strict";
import {normalizeManualBankReference as norm} from "../../../lib/payments/financeV2ManualReference.mjs";
test("PAY1 normalized manual UTR matches planned btrim upper SQL unique key",()=>{
 assert.equal(norm(" UPI "," abC123 ").reference,"ABC123");
 assert.equal(norm("bank_transfer","ABC123").reference,"ABC123");
});
test("PAY1 bank/UPI payment requires reference before any paid authority",()=>{
 for(const rail of ["UPI","NEFT","IMPS","RTGS","bank transfer"]){
 assert.throws(()=>norm(rail,null),/REFERENCE_REQUIRED/);
 }
});
test("PAY1 manual endpoint must not impersonate Razorpay capture",()=>{
 for(const rail of ["razorpay","online","online_future",""]){
 assert.throws(()=>norm(rail,"ABC123"),/RAIL_INVALID/);
 }
 for(const token of ["a","has white space","<>bad ref"]){
 assert.throws(()=>norm("UPI",token),/REFERENCE_INVALID/);
 }
});
test("PAY1 legacy cash intent can be pending, not bank-verified",()=>{
 assert.deepEqual(norm("Cash",null),{method:"cash",reference:null,needsBankStatementVerification:false});
});

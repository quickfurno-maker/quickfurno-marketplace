import importlib.util
import json
import unittest
import urllib.error
from pathlib import Path
p=Path(__file__).with_name("f14_probe_public_core.py")
spec=importlib.util.spec_from_file_location("f14probe",p)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Response:
 def __init__(self,status):self.status=status
 def close(self):pass
class ProbeTests(unittest.TestCase):
 def test_01_expected_get_only(self):
  seen=[]
  def op(req,timeout):
   seen.append((req.full_url,req.get_method()))
   path=req.full_url.removeprefix(mod.BASE)
   return Response(mod.ENDPOINTS[path])
  x=mod.probe(op)
  self.assertTrue(x["allBoundariesMatched"])
  self.assertTrue(all(method=="GET" for _,method in seen))
  self.assertEqual(len(seen),4)
 def test_02_302_redirect_fails_closed(self):
  x=mod.probe(lambda req,timeout:Response(302))
  self.assertFalse(x["allBoundariesMatched"])
 def test_03_no_real_callback_claims_even_if_pass(self):
  x=mod.probe(lambda req,timeout:Response(mod.ENDPOINTS[req.full_url.removeprefix(mod.BASE)]))
  self.assertFalse(x["providerDashboardCallbackRegistered"])
  self.assertFalse(x["supabaseAuthHookConfigured"])
  self.assertFalse(x["realSignedCallbackVerified"])
  self.assertFalse(x["maySendOtp"])
  self.assertEqual(x["releaseVerdict"],"HOLD")
 def test_04_untrusted_network_error_denies(self):
  x=mod.probe(lambda req,timeout:(_ for _ in ()).throw(urllib.error.URLError("timeout")))
  self.assertFalse(x["allBoundariesMatched"])
 def test_05_no_tokens_in_request_headers(self):
  def op(req,timeout):
   h=str(req.headers).lower()
   self.assertNotIn("authorization",h)
   self.assertNotIn("token",h)
   return Response(mod.ENDPOINTS[req.full_url.removeprefix(mod.BASE)])
  mod.probe(op)
if __name__=="__main__":unittest.main()

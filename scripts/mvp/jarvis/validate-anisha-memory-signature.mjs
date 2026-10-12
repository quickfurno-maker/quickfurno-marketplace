import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  qfjSignedRequestSigningInput, verifyQfjSignedRequestSignature,
} from '../../../lib/jarvis/signedRequestAuth.ts';
import {
  ANISHA_PURGE_CLAIM_DOMAIN, ANISHA_PURGE_CLAIM_PATH,
  parseAnishaPurgeClaim,
} from '../../../lib/jarvis/anishaMemoryPurgeContract.ts';
import {
  QFJ_ANISHA_MEMORY_CONSENT_DOMAIN, QFJ_ANISHA_MEMORY_CONSENT_PATH,
  parseAnishaMemoryConsentReadRequest,
} from '../../../lib/jarvis/anishaMemoryConsentContract.ts';

const kp = generateKeyPairSync('ed25519');
const now = new Date().toISOString();
const requestId = '11111111-1111-4111-8111-111111111111';
const keyId = 'staging-cert-key';
const keys = [{
  keyId, publicKeyPem: kp.publicKey.export({type:'spki',format:'pem'}).toString(),
}];
let checks = 0;
function check(label, ok) {
  if (!ok) throw Error('FAIL '+label);
  checks++; console.log('PASS '+label);
}
const fixtures = [
  {
    domain: ANISHA_PURGE_CLAIM_DOMAIN,path: ANISHA_PURGE_CLAIM_PATH,
    request: {
      protocol:'qfj.anisha.memory-purge',version:1,action:'CLAIM',caller:'qf-jarvis',
      audience:'quickfurno-core',requestId,issuedAt:now,maxItems:5,
    },
    parse: parseAnishaPurgeClaim,
  },
  {
    domain: QFJ_ANISHA_MEMORY_CONSENT_DOMAIN,path: QFJ_ANISHA_MEMORY_CONSENT_PATH,
    request: {
      protocol:'qfj.anisha.memory-consent',version:1,caller:'qf-jarvis',
      audience:'quickfurno-core',requestId,issuedAt:now,tenantId:'quickfurno',
      vendorId:'44444444-4444-4444-8444-444444444444',
      conversationId:'22222222-2222-4222-8222-222222222222',expectedRevision:9,
    },parse:parseAnishaMemoryConsentReadRequest,
  },
];
for (const fixture of fixtures) {
  check('strict payload shape '+fixture.path, fixture.parse(fixture.request)!==null);
  const raw = Buffer.from(JSON.stringify(fixture.request));
  const digest = createHash('sha256').update(raw).digest('base64url');
  const signedMessage = qfjSignedRequestSigningInput({
    domain:fixture.domain,path:fixture.path,requestId,issuedAt:now,
    keyId,bodyDigest:digest,
  });
  const signature = sign(null,Buffer.from(signedMessage),kp.privateKey).toString('base64url');
  const headers = new Headers({'x-qfj-key-id':keyId,'x-qfj-signature':signature});
  const base = {
    rawBody:new Uint8Array(raw),domain:fixture.domain,path:fixture.path,
    requestId,issuedAt:now,keyId,signature,keys,now,requestHeaders:headers,
  };
  check('actual Core verifier accepts valid signed '+fixture.path,
    verifyQfjSignedRequestSignature(base));
  check('actual Core verifier rejects tampered body '+fixture.path,
    !verifyQfjSignedRequestSignature({
      ...base,rawBody:new Uint8Array(Buffer.concat([raw,Buffer.from('x')])),
    }));
  check('actual Core verifier rejects wrong domain '+fixture.path,
    !verifyQfjSignedRequestSignature({...base,domain:'wrong.domain'}));
  check('actual Core verifier rejects stale issuance '+fixture.path,
    !verifyQfjSignedRequestSignature({
      ...base, now:new Date(Date.parse(now)+3600_000).toISOString(),
    }));
}
console.log('RESULT '+checks+' passed, 0 failed');

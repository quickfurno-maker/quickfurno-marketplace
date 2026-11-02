// Paging is strictly client-side over already Core-authorized, bounded rows.
// It is NOT an API pagination cursor or a complete inventory count.
export const PAGE_SIZE=20;
export function scopedQueuePage(rows,page){
 if(!Array.isArray(rows)||!Number.isSafeInteger(page)||page<1)return {page:1,pages:1,rows:[]};
 const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
 const p=Math.min(page,pages);
 return {page:p,pages,rows:rows.slice((p-1)*PAGE_SIZE,p*PAGE_SIZE)};
}

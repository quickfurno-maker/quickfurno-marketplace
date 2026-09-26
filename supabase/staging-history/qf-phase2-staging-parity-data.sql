-- QuickFurno Phase 2 staging parity data/runtime setup.
-- STAGING-ONLY OPERATOR RECORD. This file is intentionally outside supabase/migrations.
-- Production is the reference and was read-only during this phase.
-- Do not execute this file against production.

begin;

insert into public.cities (id,name,slug,is_active) values
('7e3f283f-6065-41fc-8fb1-d2846808a995','Bengaluru','bengaluru',false),
('58a2c857-c71e-4823-b910-a4b6039858fe','Delhi','delhi',false),
('2e0cf9af-173a-4720-a959-a879ed7193ad','Hyderabad','hyderabad',false),
('2595ed7e-1f24-449c-b89f-19fc612c4e29','Nagpur','nagpur',false),
('e0c7cfd2-3dcc-4139-a06d-fe046d715fcd','Nashik','nashik',false),
('5e04ae0d-0cd1-4fd3-8935-9a19f4eca720','Pune','pune',true)
on conflict (slug) do update set name=excluded.name,is_active=excluded.is_active;

insert into public.service_categories (id,name,slug,is_active) values
('11344a91-209f-436d-b6a9-dcf662197322','Carpenters','carpenters',true),
('c462a5be-978d-45a0-93c2-2f1db5b9efc3','Carpentry','carpentry',false),
('f37d1ccc-84ba-4099-b5b7-b1947775bc21','Civil Work','civil-work',true),
('287e0a30-d8b6-4281-b253-fa603de67321','Custom Furniture','custom-furniture',false),
('6cbb1de6-1759-4547-9a46-0e8fa424297e','False Ceiling','false-ceiling',true),
('be8718ec-b9dd-4c47-baa3-a8ea9bba428b','Full Home Interior','full-home-interior',false),
('09c70e5e-87ee-4e26-8db1-3ca40ec11013','Home Renovation','home-renovation',false),
('8cbd3abc-2fff-4eec-aef9-fefcc72f0001','Interior','interior',true),
('e1eccaae-b612-41ec-aaa2-f26576367467','Interior Designers','interior-designers',true),
('f433415b-df54-4026-af26-6aabf37c65a0','Modular Factory','modular-factory',true),
('bfad70bf-3633-4de1-9159-3917768b86d7','Modular Kitchen','modular-kitchen',false),
('b2381fcf-82e4-422f-8e8d-49824016925c','Painter','painter',true),
('badd8e2c-3f57-4816-9734-721b959924eb','Painting','painting',false),
('3bdc941f-6231-4c9b-a061-1fb86a372c71','Premium Interiors','premium-interiors',true),
('2edf5617-4e79-4b1d-9a22-c111d1aedbd1','Sofa','sofa',true),
('e7954eb2-1f33-452c-a73d-26894b7e354a','Wardrobe','wardrobe',false)
on conflict (slug) do update set name=excluded.name,is_active=excluded.is_active;

insert into public.packages
(id,name,lead_count,price_per_lead,total_price,display_price,validity_days,is_active) values
('d9ad6455-a35a-4bda-96f3-293d18fd5698','Starter Pack',5,250,1250,1250,30,true),
('54d6f319-5029-4190-bc5d-239e1c707fca','Growth Pack',15,229,3435,3499,45,true),
('71da3cdc-4a08-4680-9991-b13e70e89693','Pro Pack',30,219,6570,6499,60,true),
('6bf978c2-1a2c-4cad-ac20-f4fccbdb7c80','Premium Pack',50,209,10450,10499,75,true)
on conflict (id) do update set
name=excluded.name,lead_count=excluded.lead_count,price_per_lead=excluded.price_per_lead,
total_price=excluded.total_price,display_price=excluded.display_price,
validity_days=excluded.validity_days,is_active=excluded.is_active;

-- Keep every pre-existing non-QA active vendor out of the Phase 3 matching pool.
update public.vendors
set is_active=false, public_visibility=false, accepting_leads=false
where is_active is true
and id not in (
'4ba5bad6-8997-45eb-a66b-dcf8c250fcac'::uuid,
'2cb87658-8db8-4023-ad29-0841738784b2'::uuid,
'282dc778-3a1e-444a-a522-f11828603fb7'::uuid
);

-- Deterministic Pune-only QA pool. Public visibility stays OFF.
update public.vendors
set status='Approved', is_active=true, public_visibility=false, accepting_leads=true
where id in (
'4ba5bad6-8997-45eb-a66b-dcf8c250fcac'::uuid,
'2cb87658-8db8-4023-ad29-0841738784b2'::uuid,
'282dc778-3a1e-444a-a522-f11828603fb7'::uuid
);

update public.marketplace_runtime_settings
set value='"auto_suggest"'::jsonb,
updated_by='phase2_staging_parity',
updated_at=now()
where key='auto_assignment_mode';

commit;

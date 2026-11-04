import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from './app.js';
import { MemoryRepository } from './repository.js';
import { couponInput } from './validation.js';

const product={id:'p1',name:'Brass Bowl',category:'Brass',price_inr:5000,availability:'available',stock:20,active:true,verification_status:'verified',variants:[]};
function repo(seed={}) { return new MemoryRepository({products:[{...product}],...seed}); }
const item=[{id:'p1',quantity:1}];
const offer=(code,extra={})=>({code,discount_type:'percentage',discount_value:10,min_order_inr:0,per_customer_limit:2,applicability:'all',active:true,...extra});

test('coupon discounts enforce percentage, fixed amount, cap, floor, time and status rules',async()=>{
 const r=repo();
 const percent=await r.createCoupon(offer('TEN',{max_discount_inr:1000}));
 const exampleA=await r.validateCoupon(' ten ',item,'c1'); assert.equal(exampleA.discount_inr,500); assert.equal(exampleA.subtotal-exampleA.discount_inr,4500);
 const highCart=repo(); highCart.products[0].price_inr=20000;
 const exampleBcoupon=await highCart.createCoupon(offer('TWENTY',{discount_value:20,max_discount_inr:1000}));
 const exampleB=await highCart.validateCoupon(exampleBcoupon.code,item,'c1'); assert.equal(exampleB.discount_inr,1000); assert.equal(exampleB.subtotal-exampleB.discount_inr,19000);
 r.products[0].price_inr=3000;
 const fixed=await r.createCoupon(offer('FIX',{discount_type:'fixed',discount_value:200}));
 const exampleC=await r.validateCoupon(fixed.code,item,'c1'); assert.equal(exampleC.discount_inr,200); assert.equal(exampleC.subtotal-exampleC.discount_inr,2800);
 const capped=await r.createCoupon(offer('CAP',{max_discount_inr:100}));
 assert.equal((await r.validateCoupon(capped.code,item,'c1')).discount_inr,100);
 const minimum=await r.createCoupon(offer('MIN',{min_order_inr:2000}));
 r.products[0].price_inr=1500;
 await assert.rejects(r.validateCoupon(minimum.code,item,'c1'),/Minimum order/);
 const tooLarge=await r.createCoupon(offer('LARGE',{discount_type:'fixed',discount_value:20000})); const exampleE=await r.validateCoupon(tooLarge.code,item,'c1'); assert.equal(exampleE.discount_inr,1500); assert.equal(Math.max(0,exampleE.subtotal-exampleE.discount_inr),0);
 const expired=await r.createCoupon(offer('OLD',{expires_at:'2020-01-01T00:00:00Z'}));
 await assert.rejects(r.validateCoupon(expired.code,item,'c1'),/expired/i);
 const inactive=await r.createCoupon(offer('OFF',{active:false}));
 await assert.rejects(r.validateCoupon(inactive.code,item,'c1'),/inactive/i);
 const future=await r.createCoupon(offer('LATER',{starts_at:'2099-01-01T00:00:00Z'}));
 await assert.rejects(r.validateCoupon(future.code,item,'c1'),/not active yet/i);
});

test('coupon usage limits, first order and product/category applicability are checked from repository data',async()=>{
 const r=repo();
 const total=await r.createCoupon(offer('ONCE',{total_usage_limit:1}));
 await r.createOrderWithInventory({customer_id:'c1',customer:{email:'one@test.local'},requestedItems:item,coupon_code:total.code,status:'pending'});
 await assert.rejects(r.validateCoupon(total.code,item,'c2'),/usage limit/i);
 const perCustomer=await r.createCoupon(offer('PER',{per_customer_limit:1}));
 await r.createOrderWithInventory({customer_id:'c1',customer:{email:'one@test.local'},requestedItems:item,coupon_code:perCustomer.code,status:'pending'});
 await assert.rejects(r.validateCoupon(perCustomer.code,item,'c1'),/usage limit/i);
 const first=await r.createCoupon(offer('FIRST',{first_order_only:true}));
 await assert.rejects(r.validateCoupon(first.code,item,'c1'),/first orders/i);
 const productOnly=await r.createCoupon(offer('PROD',{applicability:'products',applicable_product_ids:['other']}));
 await assert.rejects(r.validateCoupon(productOnly.code,item,'c2'),/eligible products/i);
 const category=await r.createCoupon(offer('CAT',{applicability:'categories',applicable_categories:['Copper']}));
 await assert.rejects(r.validateCoupon(category.code,item,'c2'),/eligible categories/i);
 const mixed=repo(); mixed.products.push({...product,id:'p2',name:'Copper Plate',category:'Copper',price_inr:2000,stock:20});
 const selectedProduct=await mixed.createCoupon(offer('ONLYBOWL',{applicability:'products',applicable_product_ids:['p1']}));
 assert.equal((await mixed.validateCoupon(selectedProduct.code,[...item,{id:'p2',quantity:1}],'c2')).discount_inr,500);
 const selectedCategory=await mixed.createCoupon(offer('ONLYCOPPER',{applicability:'categories',applicable_categories:['Copper']}));
 assert.equal((await mixed.validateCoupon(selectedCategory.code,[...item,{id:'p2',quantity:1}],'c2')).discount_inr,200);
 const free=await r.createCoupon(offer('SHIP',{discount_type:'free_delivery',discount_value:0}));
 const preview=await r.validateCoupon(free.code,item,'c2');
 assert.equal(preview.discount_inr,0); assert.equal(preview.shipping_inr,0);
});

test('failed and duplicate checkout attempts do not consume coupon usage; concurrent redemptions obey the limit',async()=>{
 const r=repo(); const coupon=await r.createCoupon(offer('RACE',{total_usage_limit:1}));
 await assert.rejects(r.createOrderWithInventory({customer_id:'c1',customer:{email:'one@test.local'},requestedItems:[{id:'missing',quantity:1}],coupon_code:coupon.code,status:'pending'}));
 assert.equal((await r.validateCoupon(coupon.code,item,'c1')).discount_inr,500);
 const input={customer_id:'c1',customer:{email:'one@test.local'},requestedItems:item,coupon_code:coupon.code,status:'pending',idempotency_key:'same-request'};
 const [a,b]=await Promise.all([r.createOrderWithInventory(input),r.createOrderWithInventory(input)]);
 assert.equal([a,b].filter(x=>!x.duplicate).length,1);
 assert.equal(r.orders.filter(o=>o.coupon_code===coupon.code).length,1);
 await assert.rejects(r.validateCoupon(coupon.code,item,'c2'),/usage limit/i);
});

test('coupon management is admin-only and customer validation ignores a forged discount amount',async()=>{
 const r=repo({adminUsers:[{id:'admin-1',email:'admin@test.local',password_hash:await bcrypt.hash('correct horse battery staple',4),role:'admin'}]}); const coupon=await r.createCoupon(offer('SAFE'));
 const {app}=createApp({repo:r,secret:'coupon-test-secret'});
 const unauthorized=await request(app).get('/api/admin/coupons');
 assert.equal(unauthorized.status,401);
 const customer=await request(app).post('/api/customer/auth/register').send({name:'Test Buyer',email:'buyer@test.local',password:'buyer-password-123'});
 assert.equal(customer.status,201);
 const preview=await request(app).post('/api/coupons/validate').set('Cookie',customer.headers['set-cookie']).send({code:coupon.code,items:item,discount_inr:4999,total_inr:1});
 assert.equal(preview.status,200); assert.equal(preview.body.data.discount_inr,500); assert.equal(preview.body.data.total_inr,4500);
 const address={name:'Test Buyer',email:'buyer@test.local',phone:'9876543210',address:'12 Market Road, Central Bengaluru',houseStreet:'12 Market Road',locality:'Central Bengaluru',city:'Bengaluru',state:'Karnataka',pin:'560001'};
 const place=()=>request(app).post('/api/orders').set('Cookie',customer.headers['set-cookie']).set('Idempotency-Key','coupon-order-one').send({customer:address,paymentMethod:'COD',couponCode:' safe ',items:item,discount_inr:1,total_inr:1});
 const order=await place(); assert.equal(order.status,201); assert.equal(order.body.data.subtotal_inr,5000); assert.equal(order.body.data.discount_inr,500); assert.equal(order.body.data.total_inr,4500); assert.equal(order.body.data.coupon_code,'SAFE'); assert.equal(order.body.data.payment_method,'COD');
 const duplicateOrder=await place(); assert.equal(duplicateOrder.status,200); assert.equal(duplicateOrder.body.duplicate,true); assert.equal(r.orders.filter(o=>o.coupon_code==='SAFE').length,1);
 const customerCannotCreate=await request(app).post('/api/admin/coupons').set('Cookie',customer.headers['set-cookie']).send(offer('DENIED'));
 assert.equal(customerCannotCreate.status,401);
 const adminLogin=await request(app).post('/api/auth/login').send({email:'admin@test.local',password:'correct horse battery staple'});
 assert.equal(adminLogin.status,200); const cookies=adminLogin.headers['set-cookie'];
 const csrf=await request(app).get('/api/auth/csrf').set('Cookie',cookies); assert.equal(csrf.status,200);
 const adminReq=(method,path)=>request(app)[method](path).set('Cookie',cookies).set('X-CSRF-Token',csrf.body.data.token);
 const create=await adminReq('post','/api/admin/coupons').send(offer('NEW',{description:'New coupon'})); assert.equal(create.status,201);
 const duplicate=await adminReq('post','/api/admin/coupons').send(offer('new')); assert.equal(duplicate.status,409);
 const update=await adminReq('patch',`/api/admin/coupons/${create.body.data.id}`).send({active:false}); assert.equal(update.status,200); assert.equal(update.body.data.active,false);
 const usage=await request(app).get(`/api/admin/coupons/${create.body.data.id}/usage`).set('Cookie',cookies); assert.equal(usage.status,200); assert.deepEqual(usage.body.data,[]);
 const orderList=await request(app).get('/api/admin/orders').set('Cookie',cookies); assert.equal(orderList.body.data[0].coupon_code,'SAFE'); assert.equal(orderList.body.data[0].discount_inr,500);
 const statusUpdate=await adminReq('patch',`/api/admin/orders/${order.body.data.id}/status`).send({status:'confirmed'}); assert.equal(statusUpdate.status,200); assert.equal(statusUpdate.body.data.discount_inr,500);
 const remove=await adminReq('delete',`/api/admin/coupons/${create.body.data.id}`); assert.equal(remove.status,204);
});

test('coupon configuration rejects missing and zero discounts, negative amounts and invalid ranges',()=>{
 assert.throws(()=>couponInput({code:'EMPTY',discount_type:'percentage',discount_value:0}),/greater than zero/i);
 assert.throws(()=>couponInput({code:'NEG',discount_type:'fixed',discount_value:-1}),/Invalid discount value/i);
 assert.throws(()=>couponInput({code:'PCT',discount_type:'percentage',discount_value:101}),/cannot exceed 100/i);
 assert.throws(()=>couponInput({code:'RANGE',discount_type:'fixed',discount_value:10,starts_at:'2026-12-01T00:00:00Z',expires_at:'2026-11-01T00:00:00Z'}),/Expiry must be after/i);
 assert.throws(()=>couponInput({code:'TYPE'}),/Discount type is required/i);
});

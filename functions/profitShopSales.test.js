const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeShopSales } = require("./profitShopSales");

test("summarizes paid larvae and frass sales, excluding shipping and VAT", () => {
  const result = summarizeShopSales([{
    paymentStatus:"paid", amountSubtotal:1500, amountShipping:300, amountDiscount:150,
    items:[
      { name:"Happy Chicken 1kg", quantity:1, totalAmount:1000 },
      { name:"TerraGrub 500g", quantity:1, totalAmount:500 },
    ],
  }], { vatPercent:13 });
  assert.equal(result.orderCount, 1);
  assert.equal(result.soldKg, 1);
  assert.equal(result.frassSoldKg, 0.5);
  assert.ok(Math.abs(result.productRevenue - 7.9646) < 0.0001);
  assert.ok(Math.abs(result.frassRevenue - 3.9823) < 0.0001);
});

test("skips unpaid orders unless COD inclusion is requested", () => {
  const orders = [{ paymentStatus:"cash_on_delivery_pending", paymentMethod:"cash_on_delivery", items:[{ name:"Happy Chicken 1kg", totalAmount:1000 }] }];
  assert.equal(summarizeShopSales(orders).orderCount, 0);
  assert.equal(summarizeShopSales(orders, { includeCod:true }).orderCount, 1);
});

test("splits mixed larvae and frass bundles by their labelled kilograms", () => {
  const result = summarizeShopSales([{ paymentStatus:"paid", items:[{ name:"Happy Chicken 3kg + TerraGrub 1kg", totalAmount:4000 }] }]);
  assert.equal(result.soldKg, 3);
  assert.equal(result.frassSoldKg, 1);
  assert.equal(result.productRevenue, 30);
  assert.equal(result.frassRevenue, 10);
});

test("returns SKU-level sales and actual blended order economics", () => {
  const result = summarizeShopSales([{
    id:"order-1", paymentStatus:"paid", amountSubtotal:3000, amountDiscount:300, amountShipping:250,
    items:[
      { id:"happy-1kg", name:"Happy Chicken 1kg", quantity:2, totalAmount:2000 },
      { id:"terra-500g", name:"TerraGrub 500g", quantity:1, totalAmount:1000 },
    ],
  }], { vatPercent:20 });
  assert.equal(result.products.length, 2);
  assert.equal(result.products.find(item => item.sku === "happy-1kg").unitsSold, 2);
  assert.equal(result.products.find(item => item.sku === "happy-1kg").larvaeKgPerUnit, 1);
  assert.equal(result.products.find(item => item.sku === "terra-500g").frassKgPerUnit, 0.5);
  assert.equal(result.orderEconomics.averageItemsPerOrder, 3);
  assert.equal(result.orderEconomics.averageGrossOrderValue, 30);
  assert.equal(result.orderEconomics.averageDiscountPerOrder, 3);
  assert.equal(result.orderEconomics.averageNetOrderRevenue, 22.5);
  assert.equal(result.orderEconomics.averageShippingCharged, 2.5);
});

test("excludes refunded orders and reports them separately", () => {
  const result = summarizeShopSales([{ paymentStatus:"refunded", items:[{ name:"Happy Chicken 1kg", totalAmount:1000 }] }]);
  assert.equal(result.orderCount, 0);
  assert.equal(result.refundedOrderCount, 1);
  assert.equal(result.products.length, 0);
});

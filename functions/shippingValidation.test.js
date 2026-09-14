const test = require("node:test");
const assert = require("node:assert/strict");
const { validateShipping } = require("./shippingValidation");

const contact = { name: "Test Customer", phone: "6900000000", postalCode: "10558", country: "Greece" };

test("BOX NOW guest checkout does not require a street address", () => {
  assert.equal(validateShipping({ ...contact, deliveryMethod: "boxnow", boxNow: { id: "locker-1" } }), null);
});

test("courier checkout still requires a street address and city", () => {
  assert.equal(validateShipping({ ...contact, deliveryMethod: "acs" }), "Missing: addressLine1, city");
});

test("all checkout methods require customer contact details", () => {
  assert.equal(validateShipping({ deliveryMethod: "boxnow" }), "Missing: name, phone, postal, country");
});

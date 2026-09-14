# ACS production setup

The admin console's ACS tab is the primary place to configure both environments and choose which one is active. Stored values are never returned to the browser; the console only receives masked status values. No credential value belongs in this repository.

The existing `ACS_*` Firebase secrets remain supported as test defaults. Live credentials are configured in the console.

Test is the safe initial environment when no console setting has been saved. Use the Test/Live selector in the console to change it.

Deploy the ACS consumers after setting the secrets and parameter. At minimum these are `getAcsPoints`, `getAcsQuote`, `adminAcs`, `createCheckoutSession`, and `adminOrders`; Firebase may report other functions that bind the shared ACS secret list.

Before creating the first real voucher, use the ACS price calculator in the admin console. Then create and print one production voucher, confirm it in the ACS portal, and only issue the pickup list after every voucher for that date has been printed.

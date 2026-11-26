# Security Specification — NestLedger

## 1. Data Invariants
1. **Owner-Only PII**: `/users/{userId}` contains email and personal preferences and is readable/writable ONLY by `request.auth.uid == userId`.
2. **Membership Gate**: All household data (`/households/{householdId}/...`) is accessible ONLY to verified authenticated users who exist in `/households/{householdId}/members/{request.auth.uid}`.
3. **Invite-Gated Join**: Users cannot list `/households` or `/householdInvites`. Joining `/households/{householdId}/members/{memberId}` requires either being the household `ownerId` or presenting a valid `inviteCodeUsed` whose `/householdInvites/{inviteCodeUsed}` points to `householdId`.
4. **Immutable Ownership & Timestamps**: `ownerId`, `createdByUid`, `createdAt` cannot be modified on update; `createdAt == request.time` on create and `updatedAt == request.time` on update.
5. **Strict Key & Type Enforcement**: Every write checks `hasAll(...)` + `hasOnly(...)` (on create) and `affectedKeys().hasOnly(...)` (on update), plus string `.size()` bounds and positive numeric amounts.

## 2. The "Dirty Dozen" Payloads (All Must Fail with PERMISSION_DENIED)
1. Unauthenticated read on `/users/u1`
2. Cross-user read on `/users/u2` while signed in as `u1`
3. Unverified email write (`email_verified: false`) on `/households/h1`
4. Oversized document ID (`> 128` chars or invalid chars `../bad`) on `/households/h1/transactions/{txId}`
5. Shadow field injection (`isAdmin: true`) on `/users/u1` or `/households/h1/transactions/t1`
6. Identity spoofing (`createdByUid: "victim"`) when signed in as `"attacker"`
7. Negative or zero transaction amount (`amount: -500`) on `/households/h1/transactions/t1`
8. Spoofed `createdAt` client timestamp (`createdAt: timestamp(2020-01-01)`) instead of `request.time`
9. List scraping on `/householdInvites` or `/households`
10. Joining `/households/h1/members/attacker` with a bogus `inviteCodeUsed`
11. Mutating immutable `ownerId` on `/households/h1` update
12. Non-member reading or writing `/households/h1/transactions/t1`

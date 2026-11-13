-- 建立應用程式角色與資料庫。
-- yangbenbu 不是超級使用者，也沒有 BYPASSRLS，Row-Level Security 才能真正隔離各診所資料。
-- CREATEDB 是給 prisma migrate dev 建立 shadow database 用的。
CREATE ROLE yangbenbu LOGIN PASSWORD 'yangbenbu' CREATEDB;
CREATE DATABASE yangbenbu OWNER yangbenbu;
CREATE DATABASE yangbenbu_test OWNER yangbenbu;

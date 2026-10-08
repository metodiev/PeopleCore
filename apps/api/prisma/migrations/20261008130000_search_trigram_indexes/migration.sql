-- Trigram indexes backing the ILIKE/`contains` global search (SearchService).
-- `pg_trgm` is required; infra/init creates it for Docker, and the statement below
-- makes this migration self-sufficient on managed PostgreSQL.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Department_name_idx" ON "Department" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Department_code_idx" ON "Department" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Employee_firstName_idx" ON "Employee" USING GIN ("firstName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Employee_lastName_idx" ON "Employee" USING GIN ("lastName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Employee_workEmail_idx" ON "Employee" USING GIN ("workEmail" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Employee_employeeNumber_idx" ON "Employee" USING GIN ("employeeNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Document_name_idx" ON "Document" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Asset_name_idx" ON "Asset" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Asset_serialNumber_idx" ON "Asset" USING GIN ("serialNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "HRRequest_subject_idx" ON "HRRequest" USING GIN ("subject" gin_trgm_ops);

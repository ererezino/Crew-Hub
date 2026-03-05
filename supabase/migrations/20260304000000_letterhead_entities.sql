-- Letterhead entities: stores per-country addresses for PDF letterheads
CREATE TABLE org_letterhead_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  country TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, country)
);

ALTER TABLE org_letterhead_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_letterhead_entities_org_scope"
  ON org_letterhead_entities FOR ALL
  USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

-- Seed default USA entity
INSERT INTO org_letterhead_entities (org_id, country, address)
SELECT id, 'USA', '611 South Dupont Highway, Dover, Delaware, USA'
FROM orgs
LIMIT 1;

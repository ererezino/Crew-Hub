-- Phase 6 Group 5: Team Hub tables, RLS, and seed data

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS team_hubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  department VARCHAR(100),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  icon VARCHAR(50),
  visibility VARCHAR(20) DEFAULT 'department'
    CHECK (visibility IN ('department','org_wide','private')),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS team_hub_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id UUID NOT NULL REFERENCES team_hubs(id),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  cover_image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS team_hub_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES team_hub_sections(id),
  title VARCHAR(300) NOT NULL,
  content TEXT,
  page_type VARCHAR(20) DEFAULT 'document'
    CHECK (page_type IN ('document','contact_list','reference_list','runbook','table','link')),
  structured_data JSONB,
  cover_image_url TEXT,
  icon VARCHAR(50),
  pinned BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE team_hubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_hub_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_hub_pages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE team_hubs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE team_hub_sections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE team_hub_pages TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS Policies: team_hubs
-- ---------------------------------------------------------------------------

-- SELECT: users can see hubs based on visibility rules
CREATE POLICY "team_hubs_select" ON team_hubs
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      -- org_wide: anyone in same org
      (
        visibility = 'org_wide'
        AND org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
      )
      -- department: user's department matches hub department
      OR (
        visibility = 'department'
        AND org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
        AND department = (SELECT p.department FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
      )
      -- private: only creator
      OR (
        visibility = 'private'
        AND created_by = auth.uid()
      )
      -- HR_ADMIN or SUPER_ADMIN can see all hubs in their org
      OR (
        org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
        AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.deleted_at IS NULL
            AND (p.roles @> '["HR_ADMIN"]'::jsonb OR p.roles @> '["SUPER_ADMIN"]'::jsonb)
        )
      )
    )
  );

-- INSERT: TEAM_LEAD, MANAGER, HR_ADMIN, SUPER_ADMIN for matching department
CREATE POLICY "team_hubs_insert" ON team_hubs
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.deleted_at IS NULL
        AND (
          p.roles @> '["HR_ADMIN"]'::jsonb
          OR p.roles @> '["SUPER_ADMIN"]'::jsonb
          OR (
            (p.roles @> '["TEAM_LEAD"]'::jsonb OR p.roles @> '["MANAGER"]'::jsonb)
            AND (
              team_hubs.department IS NULL
              OR p.department = team_hubs.department
            )
          )
        )
    )
  );

-- UPDATE: same as INSERT
CREATE POLICY "team_hubs_update" ON team_hubs
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.deleted_at IS NULL
        AND (
          p.roles @> '["HR_ADMIN"]'::jsonb
          OR p.roles @> '["SUPER_ADMIN"]'::jsonb
          OR (
            (p.roles @> '["TEAM_LEAD"]'::jsonb OR p.roles @> '["MANAGER"]'::jsonb)
            AND (
              team_hubs.department IS NULL
              OR p.department = team_hubs.department
            )
          )
        )
    )
  )
  WITH CHECK (
    org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
  );

-- DELETE: same write roles
CREATE POLICY "team_hubs_delete" ON team_hubs
  FOR DELETE TO authenticated
  USING (
    org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.deleted_at IS NULL
        AND (
          p.roles @> '["HR_ADMIN"]'::jsonb
          OR p.roles @> '["SUPER_ADMIN"]'::jsonb
          OR (
            (p.roles @> '["TEAM_LEAD"]'::jsonb OR p.roles @> '["MANAGER"]'::jsonb)
            AND (
              team_hubs.department IS NULL
              OR p.department = team_hubs.department
            )
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- RLS Policies: team_hub_sections (inherit from parent hub)
-- ---------------------------------------------------------------------------

CREATE POLICY "team_hub_sections_select" ON team_hub_sections
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM team_hubs h
      WHERE h.id = team_hub_sections.hub_id
        AND h.deleted_at IS NULL
        AND (
          (h.visibility = 'org_wide' AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL))
          OR (h.visibility = 'department' AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL) AND h.department = (SELECT p.department FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL))
          OR (h.visibility = 'private' AND h.created_by = auth.uid())
          OR (h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.deleted_at IS NULL AND (p2.roles @> '["HR_ADMIN"]'::jsonb OR p2.roles @> '["SUPER_ADMIN"]'::jsonb)))
        )
    )
  );

CREATE POLICY "team_hub_sections_insert" ON team_hub_sections
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_hubs h
      WHERE h.id = team_hub_sections.hub_id
        AND h.deleted_at IS NULL
        AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
        AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.deleted_at IS NULL
            AND (
              p.roles @> '["HR_ADMIN"]'::jsonb
              OR p.roles @> '["SUPER_ADMIN"]'::jsonb
              OR (
                (p.roles @> '["TEAM_LEAD"]'::jsonb OR p.roles @> '["MANAGER"]'::jsonb)
                AND (h.department IS NULL OR p.department = h.department)
              )
            )
        )
    )
  );

CREATE POLICY "team_hub_sections_update" ON team_hub_sections
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM team_hubs h
      WHERE h.id = team_hub_sections.hub_id
        AND h.deleted_at IS NULL
        AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
        AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.deleted_at IS NULL
            AND (
              p.roles @> '["HR_ADMIN"]'::jsonb
              OR p.roles @> '["SUPER_ADMIN"]'::jsonb
              OR (
                (p.roles @> '["TEAM_LEAD"]'::jsonb OR p.roles @> '["MANAGER"]'::jsonb)
                AND (h.department IS NULL OR p.department = h.department)
              )
            )
        )
    )
  );

CREATE POLICY "team_hub_sections_delete" ON team_hub_sections
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM team_hubs h
      WHERE h.id = team_hub_sections.hub_id
        AND h.deleted_at IS NULL
        AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
        AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.deleted_at IS NULL
            AND (
              p.roles @> '["HR_ADMIN"]'::jsonb
              OR p.roles @> '["SUPER_ADMIN"]'::jsonb
              OR (
                (p.roles @> '["TEAM_LEAD"]'::jsonb OR p.roles @> '["MANAGER"]'::jsonb)
                AND (h.department IS NULL OR p.department = h.department)
              )
            )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- RLS Policies: team_hub_pages (inherit from parent section -> hub)
-- ---------------------------------------------------------------------------

CREATE POLICY "team_hub_pages_select" ON team_hub_pages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM team_hub_sections s
      JOIN team_hubs h ON h.id = s.hub_id
      WHERE s.id = team_hub_pages.section_id
        AND s.deleted_at IS NULL
        AND h.deleted_at IS NULL
        AND (
          (h.visibility = 'org_wide' AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL))
          OR (h.visibility = 'department' AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL) AND h.department = (SELECT p.department FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL))
          OR (h.visibility = 'private' AND h.created_by = auth.uid())
          OR (h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.deleted_at IS NULL AND (p2.roles @> '["HR_ADMIN"]'::jsonb OR p2.roles @> '["SUPER_ADMIN"]'::jsonb)))
        )
    )
  );

CREATE POLICY "team_hub_pages_insert" ON team_hub_pages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_hub_sections s
      JOIN team_hubs h ON h.id = s.hub_id
      WHERE s.id = team_hub_pages.section_id
        AND s.deleted_at IS NULL
        AND h.deleted_at IS NULL
        AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
        AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.deleted_at IS NULL
            AND (
              p.roles @> '["HR_ADMIN"]'::jsonb
              OR p.roles @> '["SUPER_ADMIN"]'::jsonb
              OR (
                (p.roles @> '["TEAM_LEAD"]'::jsonb OR p.roles @> '["MANAGER"]'::jsonb)
                AND (h.department IS NULL OR p.department = h.department)
              )
            )
        )
    )
  );

CREATE POLICY "team_hub_pages_update" ON team_hub_pages
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM team_hub_sections s
      JOIN team_hubs h ON h.id = s.hub_id
      WHERE s.id = team_hub_pages.section_id
        AND s.deleted_at IS NULL
        AND h.deleted_at IS NULL
        AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
        AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.deleted_at IS NULL
            AND (
              p.roles @> '["HR_ADMIN"]'::jsonb
              OR p.roles @> '["SUPER_ADMIN"]'::jsonb
              OR (
                (p.roles @> '["TEAM_LEAD"]'::jsonb OR p.roles @> '["MANAGER"]'::jsonb)
                AND (h.department IS NULL OR p.department = h.department)
              )
            )
        )
    )
  );

CREATE POLICY "team_hub_pages_delete" ON team_hub_pages
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM team_hub_sections s
      JOIN team_hubs h ON h.id = s.hub_id
      WHERE s.id = team_hub_pages.section_id
        AND s.deleted_at IS NULL
        AND h.deleted_at IS NULL
        AND h.org_id = (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL)
        AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = auth.uid()
            AND p.deleted_at IS NULL
            AND (
              p.roles @> '["HR_ADMIN"]'::jsonb
              OR p.roles @> '["SUPER_ADMIN"]'::jsonb
              OR (
                (p.roles @> '["TEAM_LEAD"]'::jsonb OR p.roles @> '["MANAGER"]'::jsonb)
                AND (h.department IS NULL OR p.department = h.department)
              )
            )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_team_hubs_org_id ON team_hubs(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_hubs_department ON team_hubs(department) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_hub_sections_hub_id ON team_hub_sections(hub_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_hub_pages_section_id ON team_hub_pages(section_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org_id UUID;
  -- Hub IDs
  v_cs_hub_id UUID := gen_random_uuid();
  v_mktg_hub_id UUID := gen_random_uuid();
  v_eng_hub_id UUID := gen_random_uuid();
  v_fin_hub_id UUID := gen_random_uuid();
  -- CS section IDs
  v_cs_internal UUID := gen_random_uuid();
  v_cs_helpdocs UUID := gen_random_uuid();
  v_cs_reports UUID := gen_random_uuid();
  v_cs_annex UUID := gen_random_uuid();
  v_cs_agents UUID := gen_random_uuid();
  v_cs_schedule UUID := gen_random_uuid();
  v_cs_phones UUID := gen_random_uuid();
  -- Marketing section IDs
  v_mktg_content UUID := gen_random_uuid();
  v_mktg_video UUID := gen_random_uuid();
  v_mktg_projects UUID := gen_random_uuid();
  -- Engineering section IDs
  v_eng_arch UUID := gen_random_uuid();
  v_eng_runbooks UUID := gen_random_uuid();
  v_eng_standards UUID := gen_random_uuid();
  -- Finance section IDs
  v_fin_processes UUID := gen_random_uuid();
  v_fin_templates UUID := gen_random_uuid();
BEGIN
  -- Get the first org_id from profiles
  SELECT org_id INTO v_org_id FROM profiles WHERE deleted_at IS NULL LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'No org found, skipping team hub seed data';
    RETURN;
  END IF;

  -- =========================================================================
  -- Hubs
  -- =========================================================================

  INSERT INTO team_hubs (id, org_id, department, name, description, icon, visibility)
  VALUES
    (v_cs_hub_id,   v_org_id, 'Customer Success', 'Customer Success',    'Internal knowledge base for the Customer Success team.',    'Headset',     'department'),
    (v_mktg_hub_id, v_org_id, 'Marketing',        'Content & Marketing', 'Content strategy, video production, and marketing plans.',  'Megaphone',   'department'),
    (v_eng_hub_id,  v_org_id, 'Engineering',       'Engineering',         'Architecture docs, runbooks, and engineering standards.',   'Code',        'department'),
    (v_fin_hub_id,  v_org_id, 'Finance',           'Finance',             'Finance processes and templates.',                          'Calculator',  'department');

  -- =========================================================================
  -- Sections
  -- =========================================================================

  -- Customer Success sections
  INSERT INTO team_hub_sections (id, hub_id, name, icon, sort_order)
  VALUES
    (v_cs_internal,  v_cs_hub_id, 'Internal Help-Docs',      'BookOpen',  0),
    (v_cs_helpdocs,  v_cs_hub_id, 'Help-Docs',               'FileText',  1),
    (v_cs_reports,   v_cs_hub_id, 'Reports & Surveys',       'BarChart3', 2),
    (v_cs_annex,     v_cs_hub_id, 'Annex',                   'Archive',   3),
    (v_cs_agents,    v_cs_hub_id, 'Trusted Cashramp Agents', 'Shield',    4),
    (v_cs_schedule,  v_cs_hub_id, 'Work Schedule',           'Calendar',  5),
    (v_cs_phones,    v_cs_hub_id, 'Support Phone Numbers',   'Phone',     6);

  -- Marketing sections
  INSERT INTO team_hub_sections (id, hub_id, name, icon, sort_order)
  VALUES
    (v_mktg_content,  v_mktg_hub_id, 'Content Strategy', 'Target', 0),
    (v_mktg_video,    v_mktg_hub_id, 'Video',            'Video',  1),
    (v_mktg_projects, v_mktg_hub_id, 'Projects & Plans', 'Kanban', 2);

  -- Engineering sections
  INSERT INTO team_hub_sections (id, hub_id, name, icon, sort_order)
  VALUES
    (v_eng_arch,      v_eng_hub_id, 'Architecture', 'Cpu',       0),
    (v_eng_runbooks,  v_eng_hub_id, 'Runbooks',     'Terminal',  1),
    (v_eng_standards, v_eng_hub_id, 'Standards',    'BookCheck', 2);

  -- Finance sections
  INSERT INTO team_hub_sections (id, hub_id, name, icon, sort_order)
  VALUES
    (v_fin_processes, v_fin_hub_id, 'Processes', 'Workflow',        0),
    (v_fin_templates, v_fin_hub_id, 'Templates', 'FileSpreadsheet', 1);

  -- =========================================================================
  -- Pages
  -- =========================================================================

  -- CS > Internal Help-Docs
  INSERT INTO team_hub_pages (section_id, title, content, page_type, sort_order) VALUES
    (v_cs_internal, 'Managing Inboxes and Shifts',             'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 0),
    (v_cs_internal, 'Handbook For New CS Hires',               'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 1),
    (v_cs_internal, 'Our KPIs',                                'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 2),
    (v_cs_internal, 'How To Investigate & Resolve Issues',     'Content migrating from Notion. To be updated by the Customer Success team.', 'runbook',  3),
    (v_cs_internal, 'Communication Channels',                  'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 4),
    (v_cs_internal, 'Tools and Apps',                          'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 5),
    (v_cs_internal, 'CX Calls Guide',                         'Content migrating from Notion. To be updated by the Customer Success team.', 'runbook',  6),
    (v_cs_internal, 'Guide On Using Metabase',                 'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 7),
    (v_cs_internal, 'QA/QC Tests',                             'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 8),
    (v_cs_internal, 'Research',                                'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 9);

  -- CS > Reports & Surveys
  INSERT INTO team_hub_pages (section_id, title, content, page_type, sort_order) VALUES
    (v_cs_reports, 'Monthly/Weekly Check-ins',                'Content migrating from Notion. To be updated by the Customer Success team.', 'document',       0),
    (v_cs_reports, 'User Testing Report',                     'Content migrating from Notion. To be updated by the Customer Success team.', 'document',       1),
    (v_cs_reports, 'Customer Retention Reports',              'Content migrating from Notion. To be updated by the Customer Success team.', 'document',       2),
    (v_cs_reports, 'Cashramp Agents',                         'Content migrating from Notion. To be updated by the Customer Success team.', 'reference_list', 3),
    (v_cs_reports, 'Customer Satisfaction Survey Analysis',    'Content migrating from Notion. To be updated by the Customer Success team.', 'document',       4),
    (v_cs_reports, 'App Ratings',                             'Content migrating from Notion. To be updated by the Customer Success team.', 'document',       5);

  -- CS > Annex
  INSERT INTO team_hub_pages (section_id, title, content, page_type, sort_order) VALUES
    (v_cs_annex, 'Pitches/Idea Dump', 'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 0),
    (v_cs_annex, 'Announcements',     'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 1),
    (v_cs_annex, 'Video Scripts',     'Content migrating from Notion. To be updated by the Customer Success team.', 'document', 2);

  -- CS > Trusted Cashramp Agents
  INSERT INTO team_hub_pages (section_id, title, content, page_type, sort_order) VALUES
    (v_cs_agents, 'Agent Directory', 'Content migrating from Notion. To be updated by the Customer Success team.', 'reference_list', 0);

  -- CS > Work Schedule
  INSERT INTO team_hub_pages (section_id, title, content, page_type, structured_data, sort_order) VALUES
    (v_cs_schedule, 'Work Schedule', 'Content migrating from Notion. To be updated by the Customer Success team.', 'link', '{"url":"/scheduling"}'::jsonb, 0);

  -- CS > Support Phone Numbers
  INSERT INTO team_hub_pages (section_id, title, content, page_type, structured_data, pinned, sort_order) VALUES
    (v_cs_phones, 'Support Contacts', 'Content migrating from Notion. To be updated by the Customer Success team.', 'contact_list',
     '[{"name":"Antoinette","phone":"0816 152 7390"},{"name":"Rayo","phone":"07052176801"},{"name":"Raphaela","phone":"233266211627"},{"name":"Favour","phone":"09022582108"},{"name":"Shalewa","phone":"0903 989 0140"}]'::jsonb,
     true, 0);

  -- Marketing > Content Strategy
  INSERT INTO team_hub_pages (section_id, title, content, page_type, sort_order) VALUES
    (v_mktg_content, 'Content Strategy 2025',       'Content migrating from Notion. To be updated by the Marketing team.', 'document', 0),
    (v_mktg_content, 'Content Calendar 2024',       'Content migrating from Notion. To be updated by the Marketing team.', 'document', 1),
    (v_mktg_content, 'Content Calendar 2021-2023',  'Content migrating from Notion. To be updated by the Marketing team.', 'document', 2),
    (v_mktg_content, 'Ghana Content Calendar',      'Content migrating from Notion. To be updated by the Marketing team.', 'document', 3);

  -- Marketing > Video
  INSERT INTO team_hub_pages (section_id, title, content, page_type, sort_order) VALUES
    (v_mktg_video, 'Video Editing', 'Content migrating from Notion. To be updated by the Marketing team.', 'document', 0);

  -- Marketing > Projects & Plans
  INSERT INTO team_hub_pages (section_id, title, content, page_type, sort_order) VALUES
    (v_mktg_projects, 'Q1 Projects & Timelines',                    'Content migrating from Notion. To be updated by the Marketing team.', 'document', 0),
    (v_mktg_projects, 'March Marketing Strategy',                   'Content migrating from Notion. To be updated by the Marketing team.', 'document', 1),
    (v_mktg_projects, 'April Marketing Plan',                       'Content migrating from Notion. To be updated by the Marketing team.', 'document', 2),
    (v_mktg_projects, 'May Marketing Plan',                         'Content migrating from Notion. To be updated by the Marketing team.', 'document', 3),
    (v_mktg_projects, 'June Marketing Plan',                        'Content migrating from Notion. To be updated by the Marketing team.', 'document', 4),
    (v_mktg_projects, 'Ghana Meet & Greet Brief',                   'Content migrating from Notion. To be updated by the Marketing team.', 'document', 5),
    (v_mktg_projects, 'Accrue 7% Interest Campaign',                'Content migrating from Notion. To be updated by the Marketing team.', 'document', 6),
    (v_mktg_projects, 'July 2025 Marketing & Retention Plan',       'Content migrating from Notion. To be updated by the Marketing team.', 'document', 7);

END $$;

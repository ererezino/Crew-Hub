-- Seed the default Accrue onboarding template with journey content sections
-- and dual-track tasks (employee + operations).
-- This is an idempotent upsert keyed on (org_id, name, type).

-- NOTE: This template is inserted for ALL existing orgs.
-- The 'tasks' JSONB field now contains both a 'sections' array (journey content)
-- and a 'tasks' array (actionable checklist items with track assignments).

DO $$
DECLARE
  v_org_id uuid;
  v_template_json jsonb;
BEGIN
  v_template_json := '{
    "sections": [
      {
        "id": "welcome",
        "title": "Welcome to the crew!",
        "type": "content",
        "content": "We''re so glad you''re here. This onboarding journey will help you get to know the company, your team, and everything you need to hit the ground running. Take your time — work through each section at your own pace.",
        "order": 1,
        "isRoleSpecific": false
      },
      {
        "id": "about",
        "title": "Who we are",
        "type": "content",
        "content": "Accrue is a financial technology company dedicated to building payment infrastructure for Africa. Our mission is to make commerce seamless, accessible, and rewarding for every business and individual across the continent.",
        "order": 2,
        "isRoleSpecific": false
      },
      {
        "id": "vision",
        "title": "The vision behind our work",
        "type": "content",
        "content": "Our vision is built on four pillars:\n\n**Human-Centric** — We put people at the centre of every product decision.\n\n**Ownership & Accountability** — We take responsibility for outcomes and empower each other.\n\n**Customer-Obsessed** — We listen deeply, iterate fast, and never stop improving.\n\n**Sustainable Growth** — We build for the long term, not just the next quarter.",
        "order": 3,
        "isRoleSpecific": false
      },
      {
        "id": "values",
        "title": "The values that define us",
        "type": "content",
        "content": "**Ownership & Accountability** — Own your work, own the result.\n\n**Customer Obsession** — Every feature, every fix, every conversation starts with the customer.\n\n**Agility & Innovation** — Move fast, learn faster, adapt constantly.\n\n**Reliability & Trust** — Be the person and the product people can count on.\n\n**Growth & Learning** — Curiosity is our superpower. Never stop improving.\n\n**Sustainability & Long-Term Thinking** — Build things that last.",
        "order": 4,
        "isRoleSpecific": false
      },
      {
        "id": "culture",
        "title": "How we work",
        "type": "content",
        "content": "**Transparency** — We default to open. Share context, share decisions, share learnings.\n\n**Collaboration** — No silos. Great work happens when diverse perspectives meet.\n\n**Feedback** — Give it kindly, receive it openly, act on it thoughtfully.\n\n**Work-Life Balance** — We work hard and we rest well. Sustainable pace beats burnout.\n\n**Continuous Improvement** — Every sprint is an opportunity to be better than the last.\n\n**Diversity & Inclusion** — Different backgrounds make better products.",
        "order": 5,
        "isRoleSpecific": false
      },
      {
        "id": "teams",
        "title": "Meet our teams",
        "type": "content",
        "content": "Accrue is made up of talented, passionate people across several teams:\n\n**Product & Engineering** — Building the technology that powers African commerce.\n\n**Customer Success** — The front line of our customer relationships.\n\n**Operations** — Keeping everything running smoothly behind the scenes.\n\n**Growth & Marketing** — Telling our story and growing our reach.\n\n**Finance & Compliance** — Ensuring we grow responsibly and sustainably.",
        "order": 6,
        "isRoleSpecific": false
      },
      {
        "id": "first-week",
        "title": "Your first week",
        "type": "tasks",
        "content": "Here''s what to focus on during your first week. Don''t worry about getting everything perfect — the goal is to get familiar and start building confidence.",
        "order": 7,
        "isRoleSpecific": false
      },
      {
        "id": "tools",
        "title": "Tools & setup",
        "type": "tools",
        "content": "You''ll be using several tools at Accrue. Make sure each one is set up and you can log in successfully.",
        "order": 8,
        "isRoleSpecific": false
      },
      {
        "id": "policies",
        "title": "Policies",
        "type": "policies",
        "content": "Please read and acknowledge each of the following company policies. These are important — they set expectations for how we work together.",
        "order": 9,
        "isRoleSpecific": false
      },
      {
        "id": "help",
        "title": "Help & support",
        "type": "content",
        "content": "If you ever need help or have questions, don''t hesitate to reach out:\n\n**Operations team** — operations@useaccrue.com\n\n**Your manager** — available on Slack\n\n**Crew Hub** — your home base for everything HR, onboarding, leave, and more.\n\nWelcome aboard — we''re excited to have you!",
        "order": 10,
        "isRoleSpecific": false
      }
    ],
    "tasks": [
      {
        "title": "Read the Employee Handbook",
        "description": "Review the full employee guideline document covering conduct, benefits, and expectations.",
        "category": "Policies",
        "track": "employee",
        "sectionId": "policies",
        "taskType": "link",
        "actionUrl": "/documents?category=policy",
        "actionLabel": "Open Handbook",
        "dueOffsetDays": 5
      },
      {
        "title": "Acknowledge Time Off Policy",
        "description": "Read and acknowledge the company time off and leave policy.",
        "category": "Policies",
        "track": "employee",
        "sectionId": "policies",
        "taskType": "form",
        "dueOffsetDays": 5
      },
      {
        "title": "Acknowledge Communication Policy",
        "description": "Read and acknowledge the company communication and conduct policy.",
        "category": "Policies",
        "track": "employee",
        "sectionId": "policies",
        "taskType": "form",
        "dueOffsetDays": 5
      },
      {
        "title": "Set up Slack",
        "description": "Join the company Slack workspace and introduce yourself in #general.",
        "category": "Tools Setup",
        "track": "employee",
        "sectionId": "tools",
        "taskType": "manual",
        "dueOffsetDays": 2
      },
      {
        "title": "Set up 1Password",
        "description": "Accept the 1Password invitation and configure your vault.",
        "category": "Tools Setup",
        "track": "employee",
        "sectionId": "tools",
        "taskType": "manual",
        "dueOffsetDays": 2
      },
      {
        "title": "Set up company email",
        "description": "Verify access to your company email account.",
        "category": "Tools Setup",
        "track": "employee",
        "sectionId": "tools",
        "taskType": "manual",
        "dueOffsetDays": 1
      },
      {
        "title": "Explore the Accrue app",
        "description": "Log in to the Accrue platform and explore the main features.",
        "category": "Getting Started",
        "track": "employee",
        "sectionId": "first-week",
        "taskType": "manual",
        "dueOffsetDays": 3
      },
      {
        "title": "Meet your manager",
        "description": "Schedule and attend your first 1:1 with your direct manager.",
        "category": "Getting Started",
        "track": "employee",
        "sectionId": "first-week",
        "taskType": "manual",
        "dueOffsetDays": 3
      },
      {
        "title": "Meet the team",
        "description": "Attend team introduction meeting or virtual coffee chat.",
        "category": "Getting Started",
        "track": "employee",
        "sectionId": "first-week",
        "taskType": "manual",
        "dueOffsetDays": 5
      },
      {
        "title": "Complete profile in Crew Hub",
        "description": "Fill in your personal details, emergency contact, and profile photo.",
        "category": "Getting Started",
        "track": "employee",
        "sectionId": "first-week",
        "taskType": "link",
        "actionUrl": "/me/profile",
        "actionLabel": "Go to My Profile",
        "dueOffsetDays": 3
      },
      {
        "title": "Provision company email",
        "description": "Create the new hire''s company email account in Google Workspace.",
        "category": "IT Setup",
        "track": "operations",
        "sectionId": null,
        "taskType": "manual",
        "dueOffsetDays": -1,
        "completionGuidance": "Create email in Google Workspace admin, then update profile email in Crew Hub."
      },
      {
        "title": "Set up Slack account",
        "description": "Invite the new hire to the company Slack workspace.",
        "category": "IT Setup",
        "track": "operations",
        "sectionId": null,
        "taskType": "manual",
        "dueOffsetDays": -1
      },
      {
        "title": "Set up 1Password account",
        "description": "Invite the new hire to 1Password and assign appropriate vault access.",
        "category": "IT Setup",
        "track": "operations",
        "sectionId": null,
        "taskType": "manual",
        "dueOffsetDays": -1
      },
      {
        "title": "Add to payroll",
        "description": "Register the new hire in the payroll system with correct compensation details.",
        "category": "HR & Admin",
        "track": "operations",
        "sectionId": null,
        "taskType": "manual",
        "dueOffsetDays": 0,
        "completionGuidance": "Ensure salary, start date, and bank details are correct."
      },
      {
        "title": "Prepare employment contract",
        "description": "Draft or finalize the employment contract for signing.",
        "category": "HR & Admin",
        "track": "operations",
        "sectionId": null,
        "taskType": "manual",
        "dueOffsetDays": -2
      },
      {
        "title": "Order equipment",
        "description": "Order laptop, monitor, and any other required equipment.",
        "category": "Logistics",
        "track": "operations",
        "sectionId": null,
        "taskType": "manual",
        "dueOffsetDays": -5,
        "completionGuidance": "Confirm specs with hiring manager before ordering."
      },
      {
        "title": "Schedule orientation meeting",
        "description": "Book the new hire''s orientation meeting with the team.",
        "category": "Logistics",
        "track": "operations",
        "sectionId": null,
        "taskType": "manual",
        "dueOffsetDays": 0
      },
      {
        "title": "Assign buddy/mentor",
        "description": "Pair the new hire with an onboarding buddy for their first month.",
        "category": "Logistics",
        "track": "operations",
        "sectionId": null,
        "taskType": "manual",
        "dueOffsetDays": 0
      }
    ]
  }'::jsonb;

  -- Insert for each existing org that doesn't already have a default onboarding template
  FOR v_org_id IN
    SELECT id FROM public.orgs
    WHERE NOT EXISTS (
      SELECT 1 FROM public.onboarding_templates t
      WHERE t.org_id = orgs.id
        AND t.name = 'Default Onboarding'
        AND t.type = 'onboarding'
        AND t.deleted_at IS NULL
    )
  LOOP
    INSERT INTO public.onboarding_templates (org_id, name, type, tasks)
    VALUES (v_org_id, 'Default Onboarding', 'onboarding', v_template_json);
  END LOOP;
END
$$;

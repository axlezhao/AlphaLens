-- A3.2: the controlling owner membership is the anchor of workspace
-- integrity (A3.1 already guards demotion and owner transfers). Deleting the
-- controlling owner's membership row must also be rejected at the database
-- boundary so no writer can orphan a workspace behind the API's back.
CREATE TRIGGER `workspace_members_controlling_owner_delete_guard`
BEFORE DELETE ON `workspace_members`
FOR EACH ROW WHEN OLD.`user_id` = (
  SELECT `owner_user_id` FROM `workspaces` WHERE `id` = OLD.`workspace_id`
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_controlling_owner_immutable');
END;

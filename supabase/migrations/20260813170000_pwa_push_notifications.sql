-- Phase 4C: PWA push notification infrastructure.
-- Canonical notification rows are stored in public.notifications; Web Push
-- subscriptions are an optional delivery channel owned by each authenticated user.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT push_subscriptions_endpoint_not_blank CHECK (length(trim(endpoint)) > 0),
  CONSTRAINT push_subscriptions_p256dh_not_blank CHECK (length(trim(p256dh)) > 0),
  CONSTRAINT push_subscriptions_auth_not_blank CHECK (length(trim(auth)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON public.push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active
  ON public.push_subscriptions (user_id)
  WHERE active = true AND revoked_at IS NULL;

DROP TRIGGER IF EXISTS push_subscriptions_touch_updated_at ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_touch_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

DROP POLICY IF EXISTS "Users read own push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users read own push_subscriptions"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users insert own push_subscriptions"
  ON public.push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users update own push_subscriptions"
  ON public.push_subscriptions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users delete own push_subscriptions"
  ON public.push_subscriptions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT false,
  critical_alerts boolean NOT NULL DEFAULT true,
  operational_alerts boolean NOT NULL DEFAULT true,
  financial_alerts boolean NOT NULL DEFAULT true,
  invoice_alerts boolean NOT NULL DEFAULT true,
  inventory_alerts boolean NOT NULL DEFAULT true,
  payroll_alerts boolean NOT NULL DEFAULT true,
  investor_alerts boolean NOT NULL DEFAULT false,
  system_alerts boolean NOT NULL DEFAULT true,
  min_push_severity text NOT NULL DEFAULT 'High',
  permission_state text NOT NULL DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_min_severity_check
    CHECK (min_push_severity IN ('Critical', 'High', 'Medium', 'Low')),
  CONSTRAINT notification_preferences_permission_state_check
    CHECK (permission_state IN ('default', 'granted', 'denied', 'unsupported'))
);

DROP TRIGGER IF EXISTS notification_preferences_touch_updated_at ON public.notification_preferences;
CREATE TRIGGER notification_preferences_touch_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

DROP POLICY IF EXISTS "Users read own notification_preferences" ON public.notification_preferences;
CREATE POLICY "Users read own notification_preferences"
  ON public.notification_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own notification_preferences" ON public.notification_preferences;
CREATE POLICY "Users insert own notification_preferences"
  ON public.notification_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own notification_preferences" ON public.notification_preferences;
CREATE POLICY "Users update own notification_preferences"
  ON public.notification_preferences FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  target_url text NOT NULL DEFAULT '/',
  source_type text,
  source_id uuid,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  push_attempted_at timestamptz,
  push_delivered boolean,
  push_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT notifications_category_check CHECK (
    category IN (
      'critical_alerts',
      'operational_alerts',
      'financial_alerts',
      'invoice_alerts',
      'inventory_alerts',
      'payroll_alerts',
      'investor_alerts',
      'system_alerts',
      'ai_watchdog'
    )
  ),
  CONSTRAINT notifications_severity_check CHECK (severity IN ('Critical', 'High', 'Medium', 'Low')),
  CONSTRAINT notifications_target_internal_check CHECK (target_url ~ '^/($|[^/\\])')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_recipient_dedupe
  ON public.notifications (recipient_user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_source
  ON public.notifications (source_type, source_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own notification read status" ON public.notifications;
CREATE POLICY "Users update own notification read status"
  ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  _endpoint text,
  _p256dh text,
  _auth text,
  _user_agent text DEFAULT NULL,
  _platform text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_user_id uuid;
  subscription_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF _endpoint IS NULL OR length(trim(_endpoint)) = 0 THEN
    RAISE EXCEPTION 'Endpoint is required';
  END IF;
  IF _p256dh IS NULL OR length(trim(_p256dh)) = 0 OR _auth IS NULL OR length(trim(_auth)) = 0 THEN
    RAISE EXCEPTION 'Push keys are required';
  END IF;

  SELECT user_id INTO existing_user_id
  FROM public.push_subscriptions
  WHERE endpoint = _endpoint
  FOR UPDATE;

  IF FOUND AND existing_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Subscription endpoint belongs to another user';
  END IF;

  INSERT INTO public.push_subscriptions (
    user_id, endpoint, p256dh, auth, user_agent, platform, active, revoked_at, last_seen_at
  )
  VALUES (
    auth.uid(), trim(_endpoint), trim(_p256dh), trim(_auth), _user_agent, _platform, true, NULL, now()
  )
  ON CONFLICT (endpoint) DO UPDATE
  SET p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      platform = EXCLUDED.platform,
      active = true,
      revoked_at = NULL,
      last_seen_at = now()
  RETURNING id INTO subscription_id;

  INSERT INTO public.notification_preferences (user_id, permission_state, push_enabled)
  VALUES (auth.uid(), 'granted', true)
  ON CONFLICT (user_id) DO UPDATE
  SET permission_state = 'granted',
      push_enabled = true;

  RETURN subscription_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_push_subscription(_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.push_subscriptions
  SET active = false,
      revoked_at = now()
  WHERE user_id = auth.uid()
    AND endpoint = _endpoint;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = _notification_id
    AND recipient_user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications
  SET read_at = COALESCE(read_at, now())
  WHERE recipient_user_id = auth.uid()
    AND read_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_notification_for_roles(
  _roles public.app_role[],
  _category text,
  _severity text,
  _title text,
  _body text,
  _target_url text,
  _source_type text,
  _source_id uuid,
  _dedupe_key text
)
RETURNS SETOF public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _target_url IS NULL OR _target_url !~ '^/[^/\\].*|^/$' THEN
    RAISE EXCEPTION 'Notification target_url must be an internal app path';
  END IF;

  RETURN QUERY
  WITH recipients AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = ANY(_roles)
      AND ur.role <> 'investor'::public.app_role
  ),
  inserted AS (
    INSERT INTO public.notifications (
      recipient_user_id, category, severity, title, body, target_url,
      source_type, source_id, dedupe_key
    )
    SELECT
      r.user_id, _category, _severity, _title, _body, _target_url,
      _source_type, _source_id, _dedupe_key
    FROM recipients r
    ON CONFLICT (recipient_user_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
      DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        target_url = EXCLUDED.target_url
    RETURNING *
  )
  SELECT * FROM inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_notification_push_result(
  _notification_id uuid,
  _attempted_at timestamptz,
  _delivered boolean,
  _result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications
  SET push_attempted_at = _attempted_at,
      push_delivered = _delivered,
      push_result = COALESCE(_result, '{}'::jsonb)
  WHERE id = _notification_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_subscription(text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_push_subscription(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_notification_for_roles(public.app_role[], text, text, text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_notification_push_result(uuid, timestamptz, boolean, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.register_push_subscription(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_push_subscription(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification_for_roles(public.app_role[], text, text, text, text, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_notification_push_result(uuid, timestamptz, boolean, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.notification_severity_from_operational(_severity text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _severity = 'critical' THEN 'Critical'
    WHEN _severity = 'warning' THEN 'High'
    WHEN _severity = 'info' THEN 'Low'
    ELSE 'Medium'
  END
$$;

REVOKE ALL ON FUNCTION public.notification_severity_from_operational(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_severity_from_operational(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_payment_verification_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM public.create_notification_for_roles(
      ARRAY['admin'::public.app_role],
      'financial_alerts',
      'High',
      'Payment Verification Received',
      'New payment verification requires review.',
      '/payment-verifications?request_id=' || NEW.id::text,
      'payment_verification_request',
      NEW.id,
      'payment-verification:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_verification_notification_created ON public.payment_verification_requests;
CREATE TRIGGER payment_verification_notification_created
  AFTER INSERT ON public.payment_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.create_payment_verification_notification();

CREATE OR REPLACE FUNCTION public.create_operational_alert_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  category text := CASE
    WHEN NEW.alert_type = 'stock_variance' THEN 'inventory_alerts'
    ELSE 'operational_alerts'
  END;
  roles public.app_role[] := CASE
    WHEN NEW.alert_type = 'stock_variance' THEN ARRAY['admin'::public.app_role, 'moderator'::public.app_role]
    ELSE ARRAY['admin'::public.app_role, 'moderator'::public.app_role]
  END;
BEGIN
  PERFORM public.create_notification_for_roles(
    roles,
    category,
    public.notification_severity_from_operational(NEW.severity),
    CASE WHEN NEW.alert_type = 'stock_variance' THEN 'Stock Variance Alert' ELSE 'Operational Alert' END,
    CASE
      WHEN NEW.alert_type = 'stock_variance' THEN 'Stock variance requires review.'
      ELSE 'Operational alert requires review.'
    END,
    '/operational-alerts?alert_id=' || NEW.id::text,
    'operational_alert',
    NEW.id,
    'operational-alert:' || NEW.id::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operational_alert_notification_created ON public.operational_alerts;
CREATE TRIGGER operational_alert_notification_created
  AFTER INSERT ON public.operational_alerts
  FOR EACH ROW EXECUTE FUNCTION public.create_operational_alert_notification();

CREATE OR REPLACE FUNCTION public.create_credit_purchase_due_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'unpaid'
     AND OLD.reminder_queued_at IS NULL
     AND NEW.reminder_queued_at IS NOT NULL THEN
    PERFORM public.create_notification_for_roles(
      ARRAY['admin'::public.app_role],
      'financial_alerts',
      'High',
      'Credit Purchase Due',
      'Credit inventory purchase is due soon.',
      '/credit-inventory-purchases?purchase_id=' || NEW.id::text,
      'credit_inventory_purchase',
      NEW.id,
      'credit-purchase-due:' || NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_purchase_due_notification_queued ON public.credit_inventory_purchases;
CREATE TRIGGER credit_purchase_due_notification_queued
  AFTER UPDATE OF reminder_queued_at ON public.credit_inventory_purchases
  FOR EACH ROW EXECUTE FUNCTION public.create_credit_purchase_due_notification();

REVOKE ALL ON FUNCTION public.create_payment_verification_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_operational_alert_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_credit_purchase_due_notification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_verification_notification() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_operational_alert_notification() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_credit_purchase_due_notification() TO service_role;

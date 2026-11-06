-- BUSINESS TOOLS: align subscription RPC responses with the recovered website build.
-- Run once in the SAME Supabase project after the earlier lock SQL succeeded.
-- Does not change create_customer, admin_login, or the Netlify email function.

CREATE OR REPLACE FUNCTION public.bt_customer_request_subscription(
    p_token uuid,
    p_weeks integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_customer_id uuid;
    v_request_id uuid;
    v_amount integer;
    v_bank jsonb;
BEGIN
    IF p_weeks NOT BETWEEN 1 AND 4 THEN
        RAISE EXCEPTION 'Choose a plan between 1 and 4 weeks';
    END IF;

    SELECT customer_id
    INTO v_customer_id
    FROM public.customer_sessions
    WHERE token = p_token
      AND expires_at > now();

    IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Invalid or expired customer session';
    END IF;

    v_amount := CASE p_weeks
        WHEN 1 THEN 3800
        WHEN 2 THEN 7600
        WHEN 3 THEN 11400
        WHEN 4 THEN 15200
    END;

    INSERT INTO public.bt_subscription_requests(customer_id, plan_weeks)
    VALUES (v_customer_id, p_weeks)
    RETURNING id INTO v_request_id;

    SELECT s.bank
    INTO v_bank
    FROM public.business_tools_settings s
    WHERE s.id = 1;

    RETURN jsonb_build_object(
        'success', true,
        'requestId', v_request_id,
        'status', 'Pending',
        'amount', v_amount,
        'bank', v_bank
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.bt_admin_get_customer_access(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_customers jsonb;
    v_requests jsonb;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_sessions
        WHERE token = p_token AND expires_at > now()
    ) THEN
        RAISE EXCEPTION 'Invalid or expired administrator session';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'customer_id', c.id,
        'name', c.name,
        'is_locked', coalesce(a.is_locked, false),
        'subscription_expires_at', a.expires_at,
        'plan_weeks', a.plan_weeks
    ) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_customers
    FROM public.customers c
    LEFT JOIN public.bt_customer_access a ON a.customer_id = c.id;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'customer_id', r.customer_id,
        'customer_name', c.name,
        'plan_weeks', r.plan_weeks,
        'amount', CASE r.plan_weeks
            WHEN 1 THEN 3800 WHEN 2 THEN 7600
            WHEN 3 THEN 11400 WHEN 4 THEN 15200 END,
        'status', r.status,
        'created_at', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_requests
    FROM public.bt_subscription_requests r
    JOIN public.customers c ON c.id = r.customer_id;

    RETURN jsonb_build_object(
        'customers', v_customers,
        'requests', v_requests
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bt_customer_request_subscription(uuid, integer)
TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bt_admin_get_customer_access(uuid)
TO anon, authenticated;

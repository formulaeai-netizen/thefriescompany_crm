export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      branches: {
        Row: {
          branch_name: string;
          city: string | null;
          client_id: string | null;
          created_at: string | null;
          id: string;
        };
        Insert: {
          branch_name: string;
          city?: string | null;
          client_id?: string | null;
          created_at?: string | null;
          id?: string;
        };
        Update: {
          branch_name?: string;
          city?: string | null;
          client_id?: string | null;
          created_at?: string | null;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "branches_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          account_hold: boolean | null;
          business_type: string | null;
          city: string | null;
          client_code: string | null;
          client_type: string | null;
          created_at: string | null;
          date_added: string | null;
          dba: string | null;
          email: string | null;
          id: string;
          last_order_date: string | null;
          legal_name: string;
          notes: string | null;
          phone: string | null;
          phone_normalized: string | null;
          primary_contact: string | null;
          reminders_paused: boolean | null;
          reorder_alert_sent: boolean | null;
          reorder_threshold_days: number | null;
          sales_rep: string | null;
          status: string | null;
          whatsapp_opt_out: boolean;
        };
        Insert: {
          account_hold?: boolean | null;
          business_type?: string | null;
          city?: string | null;
          client_code?: string | null;
          client_type?: string | null;
          created_at?: string | null;
          date_added?: string | null;
          dba?: string | null;
          email?: string | null;
          id?: string;
          last_order_date?: string | null;
          legal_name: string;
          notes?: string | null;
          phone?: string | null;
          phone_normalized?: string | null;
          primary_contact?: string | null;
          reminders_paused?: boolean | null;
          reorder_alert_sent?: boolean | null;
          reorder_threshold_days?: number | null;
          sales_rep?: string | null;
          status?: string | null;
          whatsapp_opt_out?: boolean;
        };
        Update: {
          account_hold?: boolean | null;
          business_type?: string | null;
          city?: string | null;
          client_code?: string | null;
          client_type?: string | null;
          created_at?: string | null;
          date_added?: string | null;
          dba?: string | null;
          email?: string | null;
          id?: string;
          last_order_date?: string | null;
          legal_name?: string;
          notes?: string | null;
          phone?: string | null;
          phone_normalized?: string | null;
          primary_contact?: string | null;
          reminders_paused?: boolean | null;
          reorder_alert_sent?: boolean | null;
          reorder_threshold_days?: number | null;
          sales_rep?: string | null;
          status?: string | null;
          whatsapp_opt_out?: boolean;
        };
        Relationships: [];
      };
      daily_production: {
        Row: {
          actual_packs_produced: number | null;
          ai_flag: string | null;
          created_at: string | null;
          date: string;
          day_end_sent: boolean | null;
          id: string;
          notes: string | null;
          pack_size_kg: number;
          packs_produced: number | null;
          raw_input_kg: number;
          target_packs: number | null;
          usable_kg: number | null;
          variance_packs: number | null;
          variance_reason: string | null;
          wastage_percent: number;
        };
        Insert: {
          actual_packs_produced?: number | null;
          ai_flag?: string | null;
          created_at?: string | null;
          date?: string;
          day_end_sent?: boolean | null;
          id?: string;
          notes?: string | null;
          pack_size_kg?: number;
          packs_produced?: number | null;
          raw_input_kg: number;
          target_packs?: number | null;
          usable_kg?: number | null;
          variance_packs?: number | null;
          variance_reason?: string | null;
          wastage_percent?: number;
        };
        Update: {
          actual_packs_produced?: number | null;
          ai_flag?: string | null;
          created_at?: string | null;
          date?: string;
          day_end_sent?: boolean | null;
          id?: string;
          notes?: string | null;
          pack_size_kg?: number;
          packs_produced?: number | null;
          raw_input_kg?: number;
          target_packs?: number | null;
          usable_kg?: number | null;
          variance_packs?: number | null;
          variance_reason?: string | null;
          wastage_percent?: number;
        };
        Relationships: [];
      };
      damaged_stock: {
        Row: {
          batch_no: string | null;
          category: string;
          created_at: string;
          entry_no: string;
          id: string;
          item_description: string;
          loss_date: string;
          notes: string | null;
          qty_lost: number;
          total_loss_value: number;
          unit_cost: number;
          updated_at: string;
        };
        Insert: {
          batch_no?: string | null;
          category?: string;
          created_at?: string;
          entry_no?: string;
          id?: string;
          item_description: string;
          loss_date?: string;
          notes?: string | null;
          qty_lost?: number;
          total_loss_value?: number;
          unit_cost?: number;
          updated_at?: string;
        };
        Update: {
          batch_no?: string | null;
          category?: string;
          created_at?: string;
          entry_no?: string;
          id?: string;
          item_description?: string;
          loss_date?: string;
          notes?: string | null;
          qty_lost?: number;
          total_loss_value?: number;
          unit_cost?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      delivery_areas: {
        Row: {
          area_name: string;
          created_at: string | null;
          distance_km: number;
          id: string;
        };
        Insert: {
          area_name: string;
          created_at?: string | null;
          distance_km: number;
          id?: string;
        };
        Update: {
          area_name?: string;
          created_at?: string | null;
          distance_km?: number;
          id?: string;
        };
        Relationships: [];
      };
      delivery_calculations: {
        Row: {
          calculated_fuel_cost: number | null;
          client_id: string | null;
          created_at: string | null;
          delivery_area: string | null;
          distance_km: number | null;
          fuel_efficiency: number | null;
          id: string;
          invoice_id: string | null;
          notes: string | null;
          petrol_rate: number | null;
          service_fee: number | null;
          total_delivery_cost: number | null;
          vehicle_type: string | null;
        };
        Insert: {
          calculated_fuel_cost?: number | null;
          client_id?: string | null;
          created_at?: string | null;
          delivery_area?: string | null;
          distance_km?: number | null;
          fuel_efficiency?: number | null;
          id?: string;
          invoice_id?: string | null;
          notes?: string | null;
          petrol_rate?: number | null;
          service_fee?: number | null;
          total_delivery_cost?: number | null;
          vehicle_type?: string | null;
        };
        Update: {
          calculated_fuel_cost?: number | null;
          client_id?: string | null;
          created_at?: string | null;
          delivery_area?: string | null;
          distance_km?: number | null;
          fuel_efficiency?: number | null;
          id?: string;
          invoice_id?: string | null;
          notes?: string | null;
          petrol_rate?: number | null;
          service_fee?: number | null;
          total_delivery_cost?: number | null;
          vehicle_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "delivery_calculations_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "delivery_calculations_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_salaries: {
        Row: {
          absent_days: number;
          advance_balance: number;
          advance_repaid: number | null;
          advance_taken: number;
          basic_salary: number;
          created_at: string;
          department: string | null;
          designation: string | null;
          employee_id: string;
          employee_name: string;
          gross_salary: number;
          id: string;
          income_tax: number;
          month: string;
          non_paid_holidays: number;
          paid: boolean;
          paid_at: string | null;
          paid_by: string | null;
          repayment_collected_by: string | null;
          total_working_days: number;
          updated_at: string;
        };
        Insert: {
          absent_days?: number;
          advance_balance?: number;
          advance_repaid?: number | null;
          advance_taken?: number;
          basic_salary?: number;
          created_at?: string;
          department?: string | null;
          designation?: string | null;
          employee_id: string;
          employee_name: string;
          gross_salary?: number;
          id?: string;
          income_tax?: number;
          month: string;
          non_paid_holidays?: number;
          paid?: boolean;
          paid_at?: string | null;
          paid_by?: string | null;
          repayment_collected_by?: string | null;
          total_working_days?: number;
          updated_at?: string;
        };
        Update: {
          absent_days?: number;
          advance_balance?: number;
          advance_repaid?: number | null;
          advance_taken?: number;
          basic_salary?: number;
          created_at?: string;
          department?: string | null;
          designation?: string | null;
          employee_id?: string;
          employee_name?: string;
          gross_salary?: number;
          id?: string;
          income_tax?: number;
          month?: string;
          non_paid_holidays?: number;
          paid?: boolean;
          paid_at?: string | null;
          paid_by?: string | null;
          repayment_collected_by?: string | null;
          total_working_days?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          added_by: string | null;
          category: string | null;
          created_at: string | null;
          created_by: string | null;
          date: string;
          id: string;
          item: string;
          price: number;
          subcategory: string | null;
        };
        Insert: {
          added_by?: string | null;
          category?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          date: string;
          id?: string;
          item: string;
          price: number;
          subcategory?: string | null;
        };
        Update: {
          added_by?: string | null;
          category?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          date?: string;
          id?: string;
          item?: string;
          price?: number;
          subcategory?: string | null;
        };
        Relationships: [];
      };
      inventory: {
        Row: {
          cost_per_unit: number | null;
          created_at: string | null;
          current_stock: number | null;
          id: string;
          item_name: string;
          minimum_stock: number | null;
          unit: string | null;
        };
        Insert: {
          cost_per_unit?: number | null;
          created_at?: string | null;
          current_stock?: number | null;
          id?: string;
          item_name: string;
          minimum_stock?: number | null;
          unit?: string | null;
        };
        Update: {
          cost_per_unit?: number | null;
          created_at?: string | null;
          current_stock?: number | null;
          id?: string;
          item_name?: string;
          minimum_stock?: number | null;
          unit?: string | null;
        };
        Relationships: [];
      };
      inventory_stock: {
        Row: {
          closing_packs: number | null;
          created_at: string | null;
          date: string;
          id: string;
          notes: string | null;
          opening_packs: number | null;
          packs_delivered: number | null;
          packs_produced: number | null;
          raw_material_kg: number | null;
        };
        Insert: {
          closing_packs?: number | null;
          created_at?: string | null;
          date?: string;
          id?: string;
          notes?: string | null;
          opening_packs?: number | null;
          packs_delivered?: number | null;
          packs_produced?: number | null;
          raw_material_kg?: number | null;
        };
        Update: {
          closing_packs?: number | null;
          created_at?: string | null;
          date?: string;
          id?: string;
          notes?: string | null;
          opening_packs?: number | null;
          packs_delivered?: number | null;
          packs_produced?: number | null;
          raw_material_kg?: number | null;
        };
        Relationships: [];
      };
      investor_returns: {
        Row: {
          created_at: string;
          id: string;
          investor_id: string;
          month: string;
          net_profit: number;
          notes: string | null;
          paid: boolean;
          paid_date: string | null;
          return_amount: number;
          return_percentage: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          investor_id: string;
          month: string;
          net_profit?: number;
          notes?: string | null;
          paid?: boolean;
          paid_date?: string | null;
          return_amount?: number;
          return_percentage?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          investor_id?: string;
          month?: string;
          net_profit?: number;
          notes?: string | null;
          paid?: boolean;
          paid_date?: string | null;
          return_amount?: number;
          return_percentage?: number;
        };
        Relationships: [
          {
            foreignKeyName: "investor_returns_investor_id_fkey";
            columns: ["investor_id"];
            isOneToOne: false;
            referencedRelation: "investors";
            referencedColumns: ["id"];
          },
        ];
      };
      investors: {
        Row: {
          created_at: string;
          duration_years: number;
          email: string;
          id: string;
          investment_amount: number;
          investment_date: string;
          investment_end_date: string;
          name: string;
          notes: string | null;
          phone: string | null;
          roi_percentage: number;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          duration_years: number;
          email: string;
          id?: string;
          investment_amount: number;
          investment_date: string;
          investment_end_date: string;
          name: string;
          notes?: string | null;
          phone?: string | null;
          roi_percentage: number;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          duration_years?: number;
          email?: string;
          id?: string;
          investment_amount?: number;
          investment_date?: string;
          investment_end_date?: string;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          roi_percentage?: number;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          amount: number | null;
          amount_received: number | null;
          branch_id: string | null;
          client_id: string | null;
          created_at: string | null;
          date: string;
          deleted_at: string | null;
          delivered: boolean | null;
          delivery_date: string | null;
          due_date: string | null;
          escalated: boolean | null;
          final_notice: boolean | null;
          id: string;
          invoice_no: string | null;
          is_deleted: boolean | null;
          item: string | null;
          last_reminder_sent: string | null;
          last_reminder_type: string | null;
          no_of_packs: number | null;
          payment_status: Database["public"]["Enums"]["payment_status_enum"] | null;
          reminder_sent: boolean | null;
          reminder_sent_at: string | null;
          screenshot_verified: boolean | null;
          total_reminders_sent: number | null;
          transaction_id: string | null;
          unit_price: number | null;
          weight_kg: number | null;
        };
        Insert: {
          amount?: number | null;
          amount_received?: number | null;
          branch_id?: string | null;
          client_id?: string | null;
          created_at?: string | null;
          date: string;
          deleted_at?: string | null;
          delivered?: boolean | null;
          delivery_date?: string | null;
          due_date?: string | null;
          escalated?: boolean | null;
          final_notice?: boolean | null;
          id?: string;
          invoice_no?: string | null;
          is_deleted?: boolean | null;
          item?: string | null;
          last_reminder_sent?: string | null;
          last_reminder_type?: string | null;
          no_of_packs?: number | null;
          payment_status?: Database["public"]["Enums"]["payment_status_enum"] | null;
          reminder_sent?: boolean | null;
          reminder_sent_at?: string | null;
          screenshot_verified?: boolean | null;
          total_reminders_sent?: number | null;
          transaction_id?: string | null;
          unit_price?: number | null;
          weight_kg?: number | null;
        };
        Update: {
          amount?: number | null;
          amount_received?: number | null;
          branch_id?: string | null;
          client_id?: string | null;
          created_at?: string | null;
          date?: string;
          deleted_at?: string | null;
          delivered?: boolean | null;
          delivery_date?: string | null;
          due_date?: string | null;
          escalated?: boolean | null;
          final_notice?: boolean | null;
          id?: string;
          invoice_no?: string | null;
          is_deleted?: boolean | null;
          item?: string | null;
          last_reminder_sent?: string | null;
          last_reminder_type?: string | null;
          no_of_packs?: number | null;
          payment_status?: Database["public"]["Enums"]["payment_status_enum"] | null;
          reminder_sent?: boolean | null;
          reminder_sent_at?: string | null;
          screenshot_verified?: boolean | null;
          total_reminders_sent?: number | null;
          transaction_id?: string | null;
          unit_price?: number | null;
          weight_kg?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_reminders: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          channel: string;
          client_id: string | null;
          created_at: string;
          delivered_at: string | null;
          due_date_snapshot: string | null;
          error_code: string | null;
          error_message: string | null;
          failed_at: string | null;
          id: string;
          idempotency_key: string;
          invoice_id: string;
          normalized_recipient_phone: string | null;
          outstanding_amount_snapshot: number;
          provider: string;
          provider_message_id: string | null;
          read_at: string | null;
          recipient_phone: string | null;
          reminder_stage: string;
          scheduled_for: string | null;
          sent_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          channel?: string;
          client_id?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          due_date_snapshot?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          failed_at?: string | null;
          id?: string;
          idempotency_key: string;
          invoice_id: string;
          normalized_recipient_phone?: string | null;
          outstanding_amount_snapshot?: number;
          provider?: string;
          provider_message_id?: string | null;
          read_at?: string | null;
          recipient_phone?: string | null;
          reminder_stage: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          channel?: string;
          client_id?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          due_date_snapshot?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          failed_at?: string | null;
          id?: string;
          idempotency_key?: string;
          invoice_id?: string;
          normalized_recipient_phone?: string | null;
          outstanding_amount_snapshot?: number;
          provider?: string;
          provider_message_id?: string | null;
          read_at?: string | null;
          recipient_phone?: string | null;
          reminder_stage?: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_reminders_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_reminders_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_reminders_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_reminder_settings: {
        Row: {
          automation_launch_date: string | null;
          created_at: string;
          dry_run: boolean;
          enabled: boolean;
          first_reminder_after_days: number;
          id: string;
          manual_approval_required: boolean;
          maximum_daily_messages: number;
          maximum_reminders: number;
          pause_all: boolean;
          provider: string;
          repeat_interval_days: number;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          automation_launch_date?: string | null;
          created_at?: string;
          dry_run?: boolean;
          enabled?: boolean;
          first_reminder_after_days?: number;
          id?: string;
          manual_approval_required?: boolean;
          maximum_daily_messages?: number;
          maximum_reminders?: number;
          pause_all?: boolean;
          provider?: string;
          repeat_interval_days?: number;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          automation_launch_date?: string | null;
          created_at?: string;
          dry_run?: boolean;
          enabled?: boolean;
          first_reminder_after_days?: number;
          id?: string;
          manual_approval_required?: boolean;
          maximum_daily_messages?: number;
          maximum_reminders?: number;
          pause_all?: boolean;
          provider?: string;
          repeat_interval_days?: number;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_screenshots: {
        Row: {
          client_id: string | null;
          created_at: string | null;
          extracted_amount: number | null;
          extracted_date: string | null;
          extracted_transaction_id: string | null;
          id: string;
          image_url: string | null;
          invoice_id: string | null;
          match_confidence: string | null;
          match_notes: string | null;
          match_status: string | null;
          matched_invoice_no: string | null;
          raw_vision_response: string | null;
          uploaded_by: string | null;
          verified: boolean | null;
          verified_by: string | null;
          whatsapp_from: string | null;
        };
        Insert: {
          client_id?: string | null;
          created_at?: string | null;
          extracted_amount?: number | null;
          extracted_date?: string | null;
          extracted_transaction_id?: string | null;
          id?: string;
          image_url?: string | null;
          invoice_id?: string | null;
          match_confidence?: string | null;
          match_notes?: string | null;
          match_status?: string | null;
          matched_invoice_no?: string | null;
          raw_vision_response?: string | null;
          uploaded_by?: string | null;
          verified?: boolean | null;
          verified_by?: string | null;
          whatsapp_from?: string | null;
        };
        Update: {
          client_id?: string | null;
          created_at?: string | null;
          extracted_amount?: number | null;
          extracted_date?: string | null;
          extracted_transaction_id?: string | null;
          id?: string;
          image_url?: string | null;
          invoice_id?: string | null;
          match_confidence?: string | null;
          match_notes?: string | null;
          match_status?: string | null;
          matched_invoice_no?: string | null;
          raw_vision_response?: string | null;
          uploaded_by?: string | null;
          verified?: boolean | null;
          verified_by?: string | null;
          whatsapp_from?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_screenshots_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_screenshots_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_verification_requests: {
        Row: {
          approved_cash_entry_id: string | null;
          claimed_amount: number | null;
          client_id: string | null;
          created_at: string;
          id: string;
          inbound_message_id: string | null;
          incoming_message: string | null;
          invoice_id: string | null;
          media_filename: string | null;
          media_mimetype: string | null;
          media_size_bytes: number | null;
          normalized_command: string | null;
          normalized_sender_phone: string | null;
          parsed_invoice_reference: string | null;
          proof_url: string | null;
          rejection_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sender_phone: string;
          status: string;
          storage_path: string | null;
        };
        Insert: {
          approved_cash_entry_id?: string | null;
          claimed_amount?: number | null;
          client_id?: string | null;
          created_at?: string;
          id?: string;
          inbound_message_id?: string | null;
          incoming_message?: string | null;
          invoice_id?: string | null;
          media_filename?: string | null;
          media_mimetype?: string | null;
          media_size_bytes?: number | null;
          normalized_command?: string | null;
          normalized_sender_phone?: string | null;
          parsed_invoice_reference?: string | null;
          proof_url?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sender_phone: string;
          status?: string;
          storage_path?: string | null;
        };
        Update: {
          approved_cash_entry_id?: string | null;
          claimed_amount?: number | null;
          client_id?: string | null;
          created_at?: string;
          id?: string;
          inbound_message_id?: string | null;
          incoming_message?: string | null;
          invoice_id?: string | null;
          media_filename?: string | null;
          media_mimetype?: string | null;
          media_size_bytes?: number | null;
          normalized_command?: string | null;
          normalized_sender_phone?: string | null;
          parsed_invoice_reference?: string | null;
          proof_url?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sender_phone?: string;
          status?: string;
          storage_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_verification_requests_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_verification_requests_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_verification_requests_approved_cash_entry_id_fkey";
            columns: ["approved_cash_entry_id"];
            isOneToOne: false;
            referencedRelation: "cash_ledger_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      operational_alerts: {
        Row: {
          actual_value: number | null;
          alert_type: string;
          created_at: string;
          expected_value: number | null;
          id: string;
          message: string;
          resolution_notes: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          severity: string;
          source_id: string;
          source_type: string;
          status: string;
          unit: string | null;
          variance_value: number | null;
        };
        Insert: {
          actual_value?: number | null;
          alert_type: string;
          created_at?: string;
          expected_value?: number | null;
          id?: string;
          message: string;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: string;
          source_id: string;
          source_type: string;
          status?: string;
          unit?: string | null;
          variance_value?: number | null;
        };
        Update: {
          actual_value?: number | null;
          alert_type?: string;
          created_at?: string;
          expected_value?: number | null;
          id?: string;
          message?: string;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: string;
          source_id?: string;
          source_type?: string;
          status?: string;
          unit?: string | null;
          variance_value?: number | null;
        };
        Relationships: [];
      };
      products: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string;
          id: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      reorder_alerts: {
        Row: {
          alert_sent: boolean | null;
          alert_sent_at: string | null;
          branch_id: string | null;
          client_id: string | null;
          created_at: string | null;
          days_since_order: number | null;
          id: string;
          last_order_date: string | null;
          resolved: boolean | null;
          resolved_at: string | null;
        };
        Insert: {
          alert_sent?: boolean | null;
          alert_sent_at?: string | null;
          branch_id?: string | null;
          client_id?: string | null;
          created_at?: string | null;
          days_since_order?: number | null;
          id?: string;
          last_order_date?: string | null;
          resolved?: boolean | null;
          resolved_at?: string | null;
        };
        Update: {
          alert_sent?: boolean | null;
          alert_sent_at?: string | null;
          branch_id?: string | null;
          client_id?: string | null;
          created_at?: string | null;
          days_since_order?: number | null;
          id?: string;
          last_order_date?: string | null;
          resolved?: boolean | null;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reorder_alerts_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reorder_alerts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      returns: {
        Row: {
          branch: string | null;
          client_name: string | null;
          created_at: string;
          id: string;
          invoice_id: string | null;
          item_description: string;
          notes: string | null;
          reason: string | null;
          return_date: string;
          return_no: string;
          return_qty: number;
          status: string;
          total_return_value: number;
          unit_price: number;
          updated_at: string;
        };
        Insert: {
          branch?: string | null;
          client_name?: string | null;
          created_at?: string;
          id?: string;
          invoice_id?: string | null;
          item_description: string;
          notes?: string | null;
          reason?: string | null;
          return_date?: string;
          return_no?: string;
          return_qty?: number;
          status?: string;
          total_return_value?: number;
          unit_price?: number;
          updated_at?: string;
        };
        Update: {
          branch?: string | null;
          client_name?: string | null;
          created_at?: string;
          id?: string;
          invoice_id?: string | null;
          item_description?: string;
          notes?: string | null;
          reason?: string | null;
          return_date?: string;
          return_no?: string;
          return_qty?: number;
          status?: string;
          total_return_value?: number;
          unit_price?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "returns_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: {
          auto_reminders_enabled: boolean | null;
          auto_verify_high_confidence: boolean | null;
          bank_details: string | null;
          created_at: string | null;
          daily_report_enabled: boolean | null;
          day_end_last_sent_at: string | null;
          day_end_notification_enabled: boolean | null;
          day_end_report_time: string | null;
          default_vehicle_type: string | null;
          id: string;
          meta_access_token: string | null;
          meta_phone_number_id: string | null;
          meta_verify_token: string | null;
          petrol_rate_per_litre: number | null;
          reorder_threshold_days: number | null;
          resend_api_key: string | null;
          sales_rep_name: string | null;
          sales_rep_phone: string | null;
          send_client_confirmation: boolean | null;
          twilio_account_sid: string | null;
          twilio_auth_token: string | null;
          twilio_whatsapp_number: string | null;
          whatsapp_group_number: string | null;
          whatsapp_report_number: string | null;
        };
        Insert: {
          auto_reminders_enabled?: boolean | null;
          auto_verify_high_confidence?: boolean | null;
          bank_details?: string | null;
          created_at?: string | null;
          daily_report_enabled?: boolean | null;
          day_end_last_sent_at?: string | null;
          day_end_notification_enabled?: boolean | null;
          day_end_report_time?: string | null;
          default_vehicle_type?: string | null;
          id?: string;
          meta_access_token?: string | null;
          meta_phone_number_id?: string | null;
          meta_verify_token?: string | null;
          petrol_rate_per_litre?: number | null;
          reorder_threshold_days?: number | null;
          resend_api_key?: string | null;
          sales_rep_name?: string | null;
          sales_rep_phone?: string | null;
          send_client_confirmation?: boolean | null;
          twilio_account_sid?: string | null;
          twilio_auth_token?: string | null;
          twilio_whatsapp_number?: string | null;
          whatsapp_group_number?: string | null;
          whatsapp_report_number?: string | null;
        };
        Update: {
          auto_reminders_enabled?: boolean | null;
          auto_verify_high_confidence?: boolean | null;
          bank_details?: string | null;
          created_at?: string | null;
          daily_report_enabled?: boolean | null;
          day_end_last_sent_at?: string | null;
          day_end_notification_enabled?: boolean | null;
          day_end_report_time?: string | null;
          default_vehicle_type?: string | null;
          id?: string;
          meta_access_token?: string | null;
          meta_phone_number_id?: string | null;
          meta_verify_token?: string | null;
          petrol_rate_per_litre?: number | null;
          reorder_threshold_days?: number | null;
          resend_api_key?: string | null;
          sales_rep_name?: string | null;
          sales_rep_phone?: string | null;
          send_client_confirmation?: boolean | null;
          twilio_account_sid?: string | null;
          twilio_auth_token?: string | null;
          twilio_whatsapp_number?: string | null;
          whatsapp_group_number?: string | null;
          whatsapp_report_number?: string | null;
        };
        Relationships: [];
      };
      stock_audits: {
        Row: {
          approval_notes: string | null;
          approved_at: string | null;
          approved_by: string | null;
          audit_date: string;
          audit_type: string;
          created_at: string;
          created_by: string | null;
          facility_name: string;
          id: string;
          locked_at: string | null;
          status: string;
        };
        Insert: {
          approval_notes?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          audit_date: string;
          audit_type: string;
          created_at?: string;
          created_by?: string | null;
          facility_name?: string;
          id?: string;
          locked_at?: string | null;
          status?: string;
        };
        Update: {
          approval_notes?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          audit_date?: string;
          audit_type?: string;
          created_at?: string;
          created_by?: string | null;
          facility_name?: string;
          id?: string;
          locked_at?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      stock_audit_items: {
        Row: {
          audit_id: string;
          created_at: string;
          id: string;
          inventory_id: string | null;
          item_name_snapshot: string;
          reconciled_quantity: number | null;
          reconciliation_reason: string | null;
          system_quantity_snapshot: number;
          unit_snapshot: string | null;
          variance_quantity: number | null;
        };
        Insert: {
          audit_id: string;
          created_at?: string;
          id?: string;
          inventory_id?: string | null;
          item_name_snapshot: string;
          reconciled_quantity?: number | null;
          reconciliation_reason?: string | null;
          system_quantity_snapshot: number;
          unit_snapshot?: string | null;
          variance_quantity?: number | null;
        };
        Update: {
          audit_id?: string;
          created_at?: string;
          id?: string;
          inventory_id?: string | null;
          item_name_snapshot?: string;
          reconciled_quantity?: number | null;
          reconciliation_reason?: string | null;
          system_quantity_snapshot?: number;
          unit_snapshot?: string | null;
          variance_quantity?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_audit_items_audit_id_fkey";
            columns: ["audit_id"];
            isOneToOne: false;
            referencedRelation: "stock_audits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_audit_items_inventory_id_fkey";
            columns: ["inventory_id"];
            isOneToOne: false;
            referencedRelation: "inventory";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_audit_submissions: {
        Row: {
          audit_id: string;
          id: string;
          notes: string | null;
          participant_type: string;
          submitted_at: string;
          submitted_by: string;
        };
        Insert: {
          audit_id: string;
          id?: string;
          notes?: string | null;
          participant_type: string;
          submitted_at?: string;
          submitted_by: string;
        };
        Update: {
          audit_id?: string;
          id?: string;
          notes?: string | null;
          participant_type?: string;
          submitted_at?: string;
          submitted_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_audit_submissions_audit_id_fkey";
            columns: ["audit_id"];
            isOneToOne: false;
            referencedRelation: "stock_audits";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_audit_submission_items: {
        Row: {
          audit_item_id: string;
          created_at: string;
          id: string;
          physical_quantity: number;
          submission_id: string;
        };
        Insert: {
          audit_item_id: string;
          created_at?: string;
          id?: string;
          physical_quantity: number;
          submission_id: string;
        };
        Update: {
          audit_item_id?: string;
          created_at?: string;
          id?: string;
          physical_quantity?: number;
          submission_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_audit_submission_items_audit_item_id_fkey";
            columns: ["audit_item_id"];
            isOneToOne: false;
            referencedRelation: "stock_audit_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_audit_submission_items_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "stock_audit_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_audit_events: {
        Row: {
          actor_id: string | null;
          audit_id: string;
          created_at: string;
          event_type: string;
          id: string;
          new_status: string;
          previous_status: string | null;
          reason: string | null;
        };
        Insert: {
          actor_id?: string | null;
          audit_id: string;
          created_at?: string;
          event_type: string;
          id?: string;
          new_status: string;
          previous_status?: string | null;
          reason?: string | null;
        };
        Update: {
          actor_id?: string | null;
          audit_id?: string;
          created_at?: string;
          event_type?: string;
          id?: string;
          new_status?: string;
          previous_status?: string | null;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_audit_events_audit_id_fkey";
            columns: ["audit_id"];
            isOneToOne: false;
            referencedRelation: "stock_audits";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          created_at: string | null;
          id: string;
          inventory_id: string | null;
          invoice_id: string | null;
          movement_date: string | null;
          movement_type: string | null;
          notes: string | null;
          quantity: number | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          inventory_id?: string | null;
          invoice_id?: string | null;
          movement_date?: string | null;
          movement_type?: string | null;
          notes?: string | null;
          quantity?: number | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          inventory_id?: string | null;
          invoice_id?: string | null;
          movement_date?: string | null;
          movement_type?: string | null;
          notes?: string | null;
          quantity?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_inventory_id_fkey";
            columns: ["inventory_id"];
            isOneToOne: false;
            referencedRelation: "inventory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      wastage_alert_settings: {
        Row: {
          created_at: string;
          expected_wastage_percent: number;
          id: string;
          low_wastage_alert_enabled: boolean;
          low_wastage_tolerance_points: number;
          updated_at: string;
          wastage_tolerance_points: number;
        };
        Insert: {
          created_at?: string;
          expected_wastage_percent?: number;
          id?: string;
          low_wastage_alert_enabled?: boolean;
          low_wastage_tolerance_points?: number;
          updated_at?: string;
          wastage_tolerance_points?: number;
        };
        Update: {
          created_at?: string;
          expected_wastage_percent?: number;
          id?: string;
          low_wastage_alert_enabled?: boolean;
          low_wastage_tolerance_points?: number;
          updated_at?: string;
          wastage_tolerance_points?: number;
        };
        Relationships: [];
      };
      wastage_verifications: {
        Row: {
          admin_decision_at: string | null;
          admin_decision_by: string | null;
          admin_decision_reason: string | null;
          ai_attempt_count: number;
          ai_detected_unit: string | null;
          ai_detected_weight: number | null;
          ai_error_code: string | null;
          ai_processed_at: string | null;
          ai_processing_started_at: string | null;
          ai_reading_quality: string | null;
          ai_result: string | null;
          created_at: string;
          daily_production_id: string;
          expected_wastage_kg_snapshot: number;
          id: string;
          image_storage_path: string;
          raw_input_kg_snapshot: number;
          staff_entered_unit: string;
          staff_entered_weight: number;
          updated_at: string;
          uploaded_at: string;
          uploaded_by: string;
          wastage_percent_snapshot: number;
          workflow_status: string;
        };
        Insert: {
          admin_decision_at?: string | null;
          admin_decision_by?: string | null;
          admin_decision_reason?: string | null;
          ai_attempt_count?: number;
          ai_detected_unit?: string | null;
          ai_detected_weight?: number | null;
          ai_error_code?: string | null;
          ai_processed_at?: string | null;
          ai_processing_started_at?: string | null;
          ai_reading_quality?: string | null;
          ai_result?: string | null;
          created_at?: string;
          daily_production_id: string;
          expected_wastage_kg_snapshot: number;
          id?: string;
          image_storage_path: string;
          raw_input_kg_snapshot: number;
          staff_entered_unit: string;
          staff_entered_weight: number;
          updated_at?: string;
          uploaded_at?: string;
          uploaded_by: string;
          wastage_percent_snapshot: number;
          workflow_status?: string;
        };
        Update: {
          admin_decision_at?: string | null;
          admin_decision_by?: string | null;
          admin_decision_reason?: string | null;
          ai_attempt_count?: number;
          ai_detected_unit?: string | null;
          ai_detected_weight?: number | null;
          ai_error_code?: string | null;
          ai_processed_at?: string | null;
          ai_processing_started_at?: string | null;
          ai_reading_quality?: string | null;
          ai_result?: string | null;
          created_at?: string;
          daily_production_id?: string;
          expected_wastage_kg_snapshot?: number;
          id?: string;
          image_storage_path?: string;
          raw_input_kg_snapshot?: number;
          staff_entered_unit?: string;
          staff_entered_weight?: number;
          updated_at?: string;
          uploaded_at?: string;
          uploaded_by?: string;
          wastage_percent_snapshot?: number;
          workflow_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wastage_verifications_daily_production_id_fkey";
            columns: ["daily_production_id"];
            isOneToOne: false;
            referencedRelation: "daily_production";
            referencedColumns: ["id"];
          },
        ];
      };
      wastage_verification_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          event_type: string;
          id: string;
          new_status: string;
          previous_status: string | null;
          reason: string | null;
          verification_id: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          event_type: string;
          id?: string;
          new_status: string;
          previous_status?: string | null;
          reason?: string | null;
          verification_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          new_status?: string;
          previous_status?: string | null;
          reason?: string | null;
          verification_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wastage_verification_events_verification_id_fkey";
            columns: ["verification_id"];
            isOneToOne: false;
            referencedRelation: "wastage_verifications";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_logs: {
        Row: {
          channel: string | null;
          client_id: string | null;
          id: string;
          invoice_id: string | null;
          message: string | null;
          sent_at: string | null;
          status: string | null;
        };
        Insert: {
          channel?: string | null;
          client_id?: string | null;
          id?: string;
          invoice_id?: string | null;
          message?: string | null;
          sent_at?: string | null;
          status?: string | null;
        };
        Update: {
          channel?: string | null;
          client_id?: string | null;
          id?: string;
          invoice_id?: string | null;
          message?: string | null;
          sent_at?: string | null;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_logs_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_logs_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      cash_settings: {
        Row: {
          effective_at: string;
          id: string;
          opening_balance: number;
          reason: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          effective_at?: string;
          id?: string;
          opening_balance?: number;
          reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          effective_at?: string;
          id?: string;
          opening_balance?: number;
          reason?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      cash_settings_history: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          effective_at: string;
          id: string;
          new_opening_balance: number;
          previous_opening_balance: number;
          reason: string | null;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          effective_at: string;
          id?: string;
          new_opening_balance: number;
          previous_opening_balance: number;
          reason?: string | null;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          effective_at?: string;
          id?: string;
          new_opening_balance?: number;
          previous_opening_balance?: number;
          reason?: string | null;
        };
        Relationships: [];
      };
      cash_ledger_entries: {
        Row: {
          amount: number;
          client_id: string | null;
          created_at: string;
          created_by: string | null;
          entry_type: string;
          id: string;
          invoice_id: string | null;
          notes: string | null;
          payment_verification_request_id: string | null;
          source_key: string;
        };
        Insert: {
          amount: number;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          entry_type: string;
          id?: string;
          invoice_id?: string | null;
          notes?: string | null;
          payment_verification_request_id?: string | null;
          source_key: string;
        };
        Update: {
          amount?: number;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          entry_type?: string;
          id?: string;
          invoice_id?: string | null;
          notes?: string | null;
          payment_verification_request_id?: string | null;
          source_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cash_ledger_entries_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_ledger_entries_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_ledger_entries_payment_verification_request_id_fkey";
            columns: ["payment_verification_request_id"];
            isOneToOne: false;
            referencedRelation: "payment_verification_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_routing_numbers: {
        Row: {
          created_at: string;
          flow_key: string;
          recipient_phone_normalized: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          flow_key: string;
          recipient_phone_normalized: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          flow_key?: string;
          recipient_phone_normalized?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      credit_inventory_purchases: {
        Row: {
          amount_due: number;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          created_at: string;
          created_by: string | null;
          due_at: string;
          id: string;
          inventory_item_id: string | null;
          item_name_snapshot: string;
          notes: string | null;
          paid_at: string | null;
          purchased_at: string;
          quantity: number | null;
          reminder_lead_hours: number;
          reminder_queued_at: string | null;
          reminder_sent_at: string | null;
          status: string;
          supplier_name: string;
          unit: string | null;
          updated_at: string;
        };
        Insert: {
          amount_due: number;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_at: string;
          id?: string;
          inventory_item_id?: string | null;
          item_name_snapshot: string;
          notes?: string | null;
          paid_at?: string | null;
          purchased_at?: string;
          quantity?: number | null;
          reminder_lead_hours?: number;
          reminder_queued_at?: string | null;
          reminder_sent_at?: string | null;
          status?: string;
          supplier_name: string;
          unit?: string | null;
          updated_at?: string;
        };
        Update: {
          amount_due?: number;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_at?: string;
          id?: string;
          inventory_item_id?: string | null;
          item_name_snapshot?: string;
          notes?: string | null;
          paid_at?: string | null;
          purchased_at?: string;
          quantity?: number | null;
          reminder_lead_hours?: number;
          reminder_queued_at?: string | null;
          reminder_sent_at?: string | null;
          status?: string;
          supplier_name?: string;
          unit?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_inventory_purchases_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      approve_payment_verification_request: {
        Args: {
          _request_id: string;
          _selected_invoice_id?: string | null;
        };
        Returns: undefined;
      };
      reject_payment_verification_request: {
        Args: {
          _reason: string;
          _request_id: string;
        };
        Returns: undefined;
      };
      set_cash_opening_balance: {
        Args: {
          _effective_at?: string;
          _opening_balance: number;
          _reason?: string | null;
        };
        Returns: undefined;
      };
      mark_salary_paid: {
        Args: {
          _salary_id: string;
        };
        Returns: undefined;
      };
      calculate_salary_net_amount: {
        Args: {
          _absent_days: number;
          _advance_taken: number;
          _gross_salary: number;
          _income_tax: number;
          _total_working_days: number;
        };
        Returns: number;
      };
      get_cash_in_hand_summary: {
        Args: Record<PropertyKey, never>;
        Returns: {
          cash_in_hand: number;
          client_payment_credits: number;
          expenses_total: number;
          opening_balance: number;
          paid_salaries_total: number;
        }[];
      };
      normalize_pk_whatsapp_phone: {
        Args: {
          _raw_phone: string;
        };
        Returns: string | null;
      };
      set_whatsapp_routing_number: {
        Args: {
          _flow_key: string;
          _recipient_phone: string;
        };
        Returns: undefined;
      };
      operational_alert_routing_flow_key: {
        Args: {
          _alert_type: string;
        };
        Returns: string;
      };
      create_credit_inventory_purchase: {
        Args: {
          _amount_due: number;
          _due_at: string;
          _inventory_item_id?: string | null;
          _item_name_snapshot: string;
          _notes?: string | null;
          _quantity?: number | null;
          _reminder_lead_hours?: number;
          _supplier_name: string;
          _unit?: string | null;
        };
        Returns: string;
      };
      update_credit_inventory_purchase: {
        Args: {
          _amount_due: number;
          _due_at: string;
          _inventory_item_id?: string | null;
          _item_name_snapshot: string;
          _notes?: string | null;
          _purchase_id: string;
          _quantity?: number | null;
          _reminder_lead_hours?: number;
          _supplier_name: string;
          _unit?: string | null;
        };
        Returns: undefined;
      };
      mark_credit_inventory_purchase_paid: {
        Args: {
          _purchase_id: string;
        };
        Returns: undefined;
      };
      cancel_credit_inventory_purchase: {
        Args: {
          _purchase_id: string;
          _reason: string;
        };
        Returns: undefined;
      };
      claim_due_credit_purchase_reminders: {
        Args: Record<PropertyKey, never>;
        Returns: {
          amount_due: number;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          created_at: string;
          created_by: string | null;
          due_at: string;
          id: string;
          inventory_item_id: string | null;
          item_name_snapshot: string;
          notes: string | null;
          paid_at: string | null;
          purchased_at: string;
          quantity: number | null;
          reminder_lead_hours: number;
          reminder_queued_at: string | null;
          reminder_sent_at: string | null;
          status: string;
          supplier_name: string;
          unit: string | null;
          updated_at: string;
        }[];
      };
      operational_comparison_precision_kg: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      resolve_operational_alert: {
        Args: {
          _alert_id: string;
          _resolution_notes: string;
        };
        Returns: undefined;
      };
      submit_wastage_verification: {
        Args: {
          _daily_production_id: string;
          _staff_entered_weight: number;
          _staff_entered_unit: string;
          _image_storage_path: string;
        };
        Returns: string;
      };
      claim_wastage_ai_processing: {
        Args: {
          _verification_id: string;
        };
        Returns: boolean;
      };
      record_wastage_ai_result: {
        Args: {
          _verification_id: string;
          _ai_result: string;
          _ai_detected_weight: number | null;
          _ai_detected_unit: string | null;
          _ai_reading_quality: string | null;
          _ai_error_code: string | null;
        };
        Returns: undefined;
      };
      approve_wastage_verification: {
        Args: {
          _verification_id: string;
        };
        Returns: undefined;
      };
      reject_wastage_verification: {
        Args: {
          _verification_id: string;
          _reason: string;
        };
        Returns: undefined;
      };
      request_resubmission_wastage_verification: {
        Args: {
          _verification_id: string;
          _reason: string;
        };
        Returns: undefined;
      };
      retry_wastage_ai_verification: {
        Args: {
          _verification_id: string;
        };
        Returns: boolean;
      };
      ensure_due_stock_audit: {
        Args: {
          _audit_date: string;
        };
        Returns: string;
      };
      submit_stock_audit_staff_count: {
        Args: {
          _audit_id: string;
          _items: Json;
          _notes: string | null;
        };
        Returns: string;
      };
      submit_stock_audit_management_count: {
        Args: {
          _audit_id: string;
          _items: Json;
          _notes: string | null;
        };
        Returns: string;
      };
      reconcile_and_lock_stock_audit: {
        Args: {
          _audit_id: string;
          _reconciled_items: Json;
          _approval_notes: string | null;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "investor" | "staff" | "moderator";
      payment_status_enum: "Done" | "Not Done" | "Partial" | "Unknown";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "investor", "staff", "moderator"],
      payment_status_enum: ["Done", "Not Done", "Partial", "Unknown"],
    },
  },
} as const;

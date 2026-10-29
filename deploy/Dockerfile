# ERPNext pinned to the production version, with the parapilot app installed.
FROM frappe/erpnext:v16.52.1

COPY --chown=frappe:frappe apps/parapilot /home/frappe/frappe-bench/apps/parapilot
RUN /home/frappe/frappe-bench/env/bin/pip install --no-cache-dir -e /home/frappe/frappe-bench/apps/parapilot

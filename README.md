# canal-manantiales

1. agregar numero socio, es unico, ya existen. PARCIAL: el campo existe y no hay duplicados, pero los numeros que tiene el sistema NO son los de la asociacion (se generaron solos al importar). Falta que nos manden el listado real. Falta ademas la restriccion UNIQUE (context.md D17).
2. sector, va asociado a parcela o sitio, ya existen. OBSOLETO: reemplazado por el punto 28, sector se elimina.
3. parcelas o sitios tienen ramal, ya estan definidos. me los tinene que mandar. RESUELTO: ramal = marco
4. cuiando aboine y despues quiero pagar todo, no se esta calculando bien.si
5. cargos: puede ser a uno en especifico o a varios. Se cobran a la siguiente temporada. pueden ser multas o cargos en general.si
6. multas: tienen una fecha para pagar, esa fecha se puede mover. Si ya pasó esa fecha, e le empieza a aplicar multa a los nuegvos pagos, cancelando fuera de plazo, y deberian generarse nuevos avisos desde que se acabó la fecha de pago. Multa no es proporcial, es 5.000 por accion o por hectarea. Podria cambiar el valor factor de multa. SI, salvo una parte OBSOLETA: la multa SI es proporcional a lo que quedaba impago al vencer el plazo (context.md D6). La fecha movible, el valor por temporada y los avisos estan hechos. NO restaurar la multa fija de esta linea.
7. revisar cuadrito amarillo con valor deuda no esta correcto.si



8. algunos tiene sitio y parcela.si
9. crear numero de socio SI, ya existe y hay que asociarlo.
10. separar apellidos. solo apellidos.SI
11. Crear campo de direccion, comuna, sector y marco.si
12. algunos deberian tener hectareas. corregir datos probando con excel. RESUELTO
13. no a todos les aparecen las propiedades. CORREGIDO CREO
14. qa en formulario pago y poner restricciones. RESUELTO: el formulario de pago ya no tiene campo de monto, todas las cifras salen del calculo de deuda, asi que no se puede equivocar el monto. Queda solo bloquear el boton mientras la deuda se esta cargando.
15. monto adeudado diferente en cuadro amarillo y cuadro de pago.resueltooo
16. AVISO DE COBRANZA SI
17. desglose por sitio y parcela en aviso.si
18. crear numero de ingreso en boleta, es un numero de talonario fisico, se ingresa al momento de pagar. RESUELTO (probado). Falta solo la restriccion UNIQUE (context.md D16).
19. cargo no siempre es proporcional a cat de acciones o hectareas.si
20. Limpia a acequia, Multa por inasistencia a reunion, Multa por inasistencia a votaciones, Cuota extraordinaria. Siempre deben aparecer como opcion. Pero se deberia poder crear nuevos.si
21. en resumen contable poner cargos.si
direccion: rinconada de manantiales, la tuna y las canchillas.
sector: borrar.
marco: canal principal, el cerrillo, cerro al peñon, el durazno, la luquita, los ortices, plaza manantiales, ramal 1.


22. probar cargos, poner multas y todo eso. RESUELTO (probado).
23. abonos deben contemplar temporadas antiguas primero, al precio de ahora o de antes? no me acuerdo. RESUELTO: de la mas antigua a la mas nueva, y cada temporada a SU precio de entonces (context.md D13).
24. en resumen contable ingresos por multa debe contener los dos tipos de multa en los cargos, por separado no mas y se elimina el campo ingreso por multa. no lo elimine pero contiene la suma
25. campo multa y cuota extra y otros en page accionistas esta demas, poner campos de cargos. si
26. si se le agrega un cargo a un accionista pero ya tebia todo pagado, entonces poner como deudor por el cargo.si
27. en abono dar opcion de elegir lo que se esta pagando. RESUELTO: no se necesita, el abono se aplica automaticamente de la deuda mas antigua a la mas nueva (context.md D3).
28. elminar campos comuna y sector.si
29. agregar tests e2e. PENDIENTE: hay tests de integracion (npm test) y el aviso esta cubierto de punta a punta, pero no hay tests de interfaz.
30. cuando new pago, indicar de qué es la multa cobrada. si
31. como redondeo o aproximo los valores que tienen decimal. CORREGIDO: se redondea a peso entero al GUARDAR, no solo al mostrar (context.md D8).
32. probar excels. RESUELTO (probado).
33. cambiar accionista de propiedad. FUTURO: queda para una version posterior, junto con el 35.
34. agregar campo rut a accinoista.si
35. subdivision de propiedades. FUTURO: queda para una version posterior, junto con el 33.
36. agregar propiedad y reemplazar por numero. RESUELTO: la propiedad se identifica por nombre ("Parcela N°8 Lote A-2"); el campo numero se elimino.
37. sacar pagos de la temporada en un excel. CORREGIDO: en "Pagos por Mes" hay un selector Por mes / Por temporada; el Excel por temporada trae pagos y abonos juntos, con subtotal por mes.


temp 26 27 empieza en marzo, y termina 28 de febrero, se abono del antiguo al mas nuevo, cubre primero la dueda y ak ultimoa las multas